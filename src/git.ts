import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { BlameInfo } from "./types";

export class GitService {
  private repoRootCache = new Map<string, string | null>();
  private remoteUrlCache = new Map<string, string | null>();
  private blameCache = new Map<string, BlameInfo>();
  private blameCacheByFile = new Map<string, Set<string>>();
  private currentUserEmailCache = new Map<string, string | null>();
  private pendingFullBlame = new Map<string, Promise<Map<number, BlameInfo> | null>>();
  private failedBlame = new Set<string>();

  /**
   * Clears the blame cache (e.g. on file save, document change, or file close).
   */
  public clearCache(filePath?: string) {
    if (filePath) {
      const keys = this.blameCacheByFile.get(filePath);
      if (keys) {
        for (const key of keys) {
          this.blameCache.delete(key);
          this.cacheKeyToFile.delete(key);
        }
        this.blameCacheByFile.delete(filePath);
      }
      for (const key of this.failedBlame) {
        if (key.startsWith(filePath)) {
          this.failedBlame.delete(key);
        }
      }
      for (const key of this.pendingFullBlame.keys()) {
        if (key.startsWith(filePath)) {
          this.pendingFullBlame.delete(key);
        }
      }
    } else {
      this.blameCache.clear();
      this.blameCacheByFile.clear();
      this.cacheKeyToFile.clear();
      this.failedBlame.clear();
      this.pendingFullBlame.clear();
      this.currentUserEmailCache.clear();
    }
  }

  /**
   * Disposes all git caches to release memory.
   */
  public dispose() {
    this.blameCache.clear();
    this.blameCacheByFile.clear();
    this.cacheKeyToFile.clear();
    this.failedBlame.clear();
    this.pendingFullBlame.clear();
    this.repoRootCache.clear();
    this.remoteUrlCache.clear();
    this.currentUserEmailCache.clear();
  }

  /**
   * Checks whether the blame for the given file, version, and line is already cached.
   */
  public hasCachedBlame(
    filePath: string,
    documentVersion: number,
    line: number,
  ): boolean {
    const cacheKey = `${filePath}:${documentVersion}:${line}`;
    const cached = this.blameCache.get(cacheKey);
    if (cached !== undefined) {
      this.blameCache.delete(cacheKey);
      this.blameCache.set(cacheKey, cached);
      return true;
    }
    return false;
  }

  /**
   * Finds the root directory of the Git repository for a given file.
   */
  public async getRepoRoot(filePath: string): Promise<string | null> {
    const dir = path.dirname(filePath);
    if (this.repoRootCache.has(dir)) {
      return this.repoRootCache.get(dir)!;
    }

    try {
      const output = await this.execGit(["rev-parse", "--show-toplevel"], dir);
      const root = output.trim();
      this.repoRootCache.set(dir, root);
      return root;
    } catch {
      this.repoRootCache.set(dir, null);
      return null;
    }
  }

  /**
   * Retrieves remote base URL (e.g. origin remote) for a repository root.
   */
  public async getRemoteBaseUrl(repoRoot: string): Promise<string | null> {
    if (!this.remoteUrlCache.has(repoRoot)) {
      try {
        const rawRemote = (
          await this.execGit(["remote", "get-url", "origin"], repoRoot)
        ).trim();
        this.remoteUrlCache.set(repoRoot, rawRemote);
      } catch {
        this.remoteUrlCache.set(repoRoot, null);
      }
    }
    return this.remoteUrlCache.get(repoRoot) ?? null;
  }

  /**
   * Retrieves remote web URL for a commit (e.g. GitHub/GitLab).
   */
  public async getRemoteCommitUrl(
    repoRoot: string,
    sha: string,
  ): Promise<string | null> {
    if (sha.replace(/0/g, "").length === 0) {
      return null;
    }

    const remote = await this.getRemoteBaseUrl(repoRoot);
    if (!remote) {
      return null;
    }

    return this.formatCommitWebUrl(remote, sha);
  }

  /**
   * Converts a git remote URL into a web commit URL.
   */
  public formatCommitWebUrl(remoteUrl: string, sha: string): string | null {
    let clean = remoteUrl.trim();
    if (clean.endsWith(".git")) {
      clean = clean.slice(0, -4);
    }

    // Handle ssh://[user@]host[:port]/path
    if (clean.startsWith("ssh://")) {
      clean = clean.replace(/^ssh:\/\/(?:[^@]+@)?/, "https://").replace(/:\d+\//, "/");
    } else if (clean.startsWith("git@")) {
      const match = clean.match(/^git@([^:]+):(.+)$/);
      if (match) {
        const [, host, repoPath] = match;
        clean = `https://${host}/${repoPath}`;
      }
    }

    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      return null;
    }

    try {
      const parsed = new URL(clean);
      // Strip any sensitive credentials (token/username:password) to prevent leakage
      parsed.username = "";
      parsed.password = "";

      const hostname = parsed.hostname.toLowerCase();
      // Ensure pathname has no trailing slash
      const cleanUrl = parsed.toString().replace(/\/$/, "");

      if (hostname.includes("gitlab")) {
        return `${cleanUrl}/-/commit/${sha}`;
      }
      if (hostname.includes("bitbucket.org")) {
        return `${cleanUrl}/commits/${sha}`;
      }
      // GitHub and others
      return `${cleanUrl}/commit/${sha}`;
    } catch {
      return null;
    }
  }

  /**
   * Blames a specific line (0-indexed) with hybrid full-file caching and process cancellation.
   */
  public async getBlameForLine(
    filePath: string,
    line: number,
    documentVersion: number,
    documentText?: string,
    isDirty: boolean = false,
    lineCount?: number,
    signal?: AbortSignal,
  ): Promise<BlameInfo | null> {
    const cacheKey = `${filePath}:${documentVersion}:${line}`;
    const cached = this.blameCache.get(cacheKey);
    if (cached !== undefined) {
      this.blameCache.delete(cacheKey);
      this.blameCache.set(cacheKey, cached);
      return cached;
    }

    if (signal?.aborted) {
      return null;
    }

    const fileVersionKey = `${filePath}:${documentVersion}`;
    if (this.failedBlame.has(fileVersionKey)) {
      return null;
    }

    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot || signal?.aborted) {
      return null;
    }

    const shouldBlameFullFile =
      !isDirty && lineCount !== undefined && lineCount <= 2500;

    try {
      const [currentUserEmail, rawRemote] = await Promise.all([
        this.getCurrentUserEmail(repoRoot),
        this.getRemoteBaseUrl(repoRoot),
      ]);

      if (signal?.aborted) {
        return null;
      }

      if (shouldBlameFullFile) {
        let fullBlamePromise = this.pendingFullBlame.get(fileVersionKey);
        if (!fullBlamePromise) {
          fullBlamePromise = (async () => {
            try {
              const output = await this.execGit(
                ["blame", "--porcelain", "--", filePath],
                repoRoot,
                undefined,
              );
              const map = this.parsePorcelain(output, repoRoot);
              let fileMtime: Date | undefined;

              for (const blame of map.values()) {
                if (blame.isUncommitted && !isDirty) {
                  if (!fileMtime) {
                    try {
                      const stat = await fs.promises.stat(filePath);
                      fileMtime = stat.mtime;
                    } catch {
                      // Keep default timestamp
                    }
                  }
                  if (fileMtime) {
                    blame.authorDate = fileMtime;
                    blame.committerDate = fileMtime;
                  }
                }

                blame.isCurrentUser =
                  blame.isUncommitted ||
                  this.isCurrentUser(blame.authorEmail, currentUserEmail);

                if (rawRemote && !blame.isUncommitted) {
                  const remoteUrl = this.formatCommitWebUrl(rawRemote, blame.sha);
                  if (remoteUrl) {
                    blame.remoteCommitUrl = remoteUrl;
                  }
                }

                this.setBlameCache(
                  filePath,
                  `${filePath}:${documentVersion}:${blame.line}`,
                  blame,
                );
              }
              return map;
            } catch {
              this.failedBlame.add(fileVersionKey);
              return null;
            } finally {
              this.pendingFullBlame.delete(fileVersionKey);
            }
          })();
          this.pendingFullBlame.set(fileVersionKey, fullBlamePromise);
        }

        const map = await fullBlamePromise;
        if (signal?.aborted || !map) {
          return null;
        }

        return map.get(line) ?? null;
      } else {
        const lineNum = line + 1; // 1-indexed for git
        const args = ["blame"];

        if (isDirty && documentText !== undefined) {
          args.push("--contents", "-");
        }

        args.push("-L", `${lineNum},${lineNum}`, "--porcelain", "--", filePath);

        const output = await this.execGit(
          args,
          repoRoot,
          isDirty && documentText !== undefined ? documentText : undefined,
          signal,
        );

        if (signal?.aborted) {
          return null;
        }

        const map = this.parsePorcelain(output, repoRoot);
        const blame = map.get(line) ?? map.values().next().value;

        if (blame) {
          if (blame.isUncommitted && !isDirty) {
            try {
              const stat = await fs.promises.stat(filePath);
              blame.authorDate = stat.mtime;
              blame.committerDate = stat.mtime;
            } catch {
              // Keep default timestamp
            }
          }

          blame.isCurrentUser =
            blame.isUncommitted ||
            this.isCurrentUser(blame.authorEmail, currentUserEmail);

          if (rawRemote && !blame.isUncommitted) {
            const remoteUrl = this.formatCommitWebUrl(rawRemote, blame.sha);
            if (remoteUrl) {
              blame.remoteCommitUrl = remoteUrl;
            }
          }

          this.setBlameCache(filePath, cacheKey, blame);
        }

        return blame ?? null;
      }
    } catch {
      if (!signal?.aborted) {
        this.failedBlame.add(fileVersionKey);
      }
      return null;
    }
  }

  private cacheKeyToFile = new Map<string, string>();

  /**
   * Sets blame into memory cache with LRU eviction guard.
   */
  private setBlameCache(filePath: string, key: string, blame: BlameInfo) {
    if (this.blameCache.size >= 5000) {
      const oldestKey = this.blameCache.keys().next().value;
      if (oldestKey) {
        this.blameCache.delete(oldestKey);
        // Clean up secondary index for evicted entry reliably across all OS platforms
        const oldFile = this.cacheKeyToFile.get(oldestKey);
        if (oldFile) {
          this.cacheKeyToFile.delete(oldestKey);
          const fileKeys = this.blameCacheByFile.get(oldFile);
          if (fileKeys) {
            fileKeys.delete(oldestKey);
            if (fileKeys.size === 0) {
              this.blameCacheByFile.delete(oldFile);
            }
          }
        }
      }
    }
    this.blameCache.set(key, blame);
    this.cacheKeyToFile.set(key, filePath);

    // Maintain secondary file index
    let fileKeys = this.blameCacheByFile.get(filePath);
    if (!fileKeys) {
      fileKeys = new Set();
      this.blameCacheByFile.set(filePath, fileKeys);
    }
    fileKeys.add(key);
  }

  /**
   * Retrieves the current git user email (user.email) for a repository.
   */
  public async getCurrentUserEmail(repoRoot: string): Promise<string | null> {
    if (this.currentUserEmailCache.has(repoRoot)) {
      return this.currentUserEmailCache.get(repoRoot)!;
    }

    try {
      const email = (await this.execGit(["config", "user.email"], repoRoot))
        .trim()
        .replace(/^["']|["']$/g, "");

      const resolvedEmail = email || process.env.GIT_AUTHOR_EMAIL || "";

      if (!resolvedEmail) {
        this.currentUserEmailCache.set(repoRoot, null);
        return null;
      }

      this.currentUserEmailCache.set(repoRoot, resolvedEmail);
      return resolvedEmail;
    } catch {
      const fallbackEmail = process.env.GIT_AUTHOR_EMAIL || "";
      if (fallbackEmail) {
        this.currentUserEmailCache.set(repoRoot, fallbackEmail);
        return fallbackEmail;
      }
      this.currentUserEmailCache.set(repoRoot, null);
      return null;
    }
  }

  /**
   * Checks whether the given commit author email matches the current Git user email.
   */
  public isCurrentUser(
    authorEmail: string,
    currentUserEmail: string | null,
  ): boolean {
    if (!currentUserEmail) {
      return false;
    }

    const cleanAuthorEmail = authorEmail
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();
    const cleanCurrentEmail = currentUserEmail
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();

    return (
      cleanCurrentEmail.length > 0 &&
      cleanAuthorEmail.length > 0 &&
      cleanCurrentEmail === cleanAuthorEmail
    );
  }

  /**
   * Fetches full commit details (subject, body, stats) for hover or quick pick.
   */
  public async getCommitDetails(
    repoRoot: string,
    sha: string,
  ): Promise<string | null> {
    try {
      const output = await this.execGit(
        ["show", "-s", "--format=%B", sha],
        repoRoot,
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Fetches full commit metadata (author, email, date, subject, full message) for a specific commit SHA.
   */
  public async getCommitMetadata(
    repoRoot: string,
    sha: string,
  ): Promise<{ author: string; authorEmail: string; authorDate: Date; summary: string; fullMessage: string } | null> {
    try {
      const output = await this.execGit(
        ["show", "-s", "--format=%an%x00%ae%x00%at%x00%s%x00%B", sha],
        repoRoot,
      );
      const parts = output.split("\0");
      if (parts.length >= 5) {
        return {
          author: parts[0],
          authorEmail: parts[1],
          authorDate: new Date(parseInt(parts[2], 10) * 1000),
          summary: parts[3],
          fullMessage: parts.slice(4).join("").trim(),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parses `git blame --porcelain` stream output for single or multiple lines.
   */
  public parsePorcelain(
    output: string,
    repoRoot: string,
  ): Map<number, BlameInfo> {
    const result = new Map<number, BlameInfo>();
    const lines = output.split("\n");
    if (lines.length === 0 || !lines[0]) {
      return result;
    }

    interface CommitMeta {
      sha: string;
      author: string;
      authorEmail: string;
      authorTime: number;
      authorTimeZone: string;
      committer: string;
      committerEmail: string;
      committerTime: number;
      summary: string;
      isUncommitted: boolean;
    }

    const commitMap = new Map<string, CommitMeta>();
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      const parts = line.split(" ");
      if (parts.length >= 3 && (parts[0].length === 40 || parts[0].length === 64)) {
        const sha = parts[0];
        const finalLine = parseInt(parts[2], 10) - 1; // 0-based
        i++;

        let meta = commitMap.get(sha);
        if (!meta) {
          const isUncommitted = sha.replace(/0/g, "").length === 0;
          meta = {
            sha,
            author: isUncommitted ? "You" : "Unknown",
            authorEmail: "",
            authorTime: Math.floor(Date.now() / 1000),
            authorTimeZone: "",
            committer: isUncommitted ? "You" : "Unknown",
            committerEmail: "",
            committerTime: Math.floor(Date.now() / 1000),
            summary: isUncommitted ? "Uncommitted changes" : "",
            isUncommitted,
          };

          while (i < lines.length && !lines[i].startsWith("\t")) {
            const header = lines[i];
            if (header.startsWith("author ")) {
              if (!meta.isUncommitted) {
                meta.author = header.substring(7).trim();
              }
            } else if (header.startsWith("author-mail ")) {
              meta.authorEmail = header
                .substring(12)
                .replace(/[<>]/g, "")
                .trim();
            } else if (header.startsWith("author-time ")) {
              meta.authorTime = parseInt(header.substring(12).trim(), 10);
            } else if (header.startsWith("author-tz ")) {
              meta.authorTimeZone = header.substring(10).trim();
            } else if (header.startsWith("committer ")) {
              if (!meta.isUncommitted) {
                meta.committer = header.substring(10).trim();
              }
            } else if (header.startsWith("committer-mail ")) {
              meta.committerEmail = header
                .substring(15)
                .replace(/[<>]/g, "")
                .trim();
            } else if (header.startsWith("committer-time ")) {
              meta.committerTime = parseInt(header.substring(15).trim(), 10);
            } else if (header.startsWith("summary ")) {
              if (!meta.isUncommitted) {
                meta.summary = header.substring(8).trim();
              }
            }
            i++;
          }
          commitMap.set(sha, meta);
        } else {
          while (i < lines.length && !lines[i].startsWith("\t")) {
            i++;
          }
        }

        if (i < lines.length && lines[i].startsWith("\t")) {
          i++;
        }

        result.set(finalLine, {
          sha: meta.sha,
          shortSha: meta.isUncommitted ? "0000000" : meta.sha.substring(0, 7),
          author: meta.author,
          authorEmail: meta.authorEmail,
          authorDate: new Date(meta.authorTime * 1000),
          authorTimeZone: meta.authorTimeZone,
          committer: meta.committer,
          committerEmail: meta.committerEmail,
          committerDate: new Date(meta.committerTime * 1000),
          summary: meta.summary,
          line: finalLine,
          isUncommitted: meta.isUncommitted,
          isCurrentUser: meta.isUncommitted,
          repoRoot,
        });
      } else {
        i++;
      }
    }

    return result;
  }

  /**
   * Helper to execute git command safely with AbortSignal cancellation support.
   */
  private execGit(
    args: string[],
    cwd: string,
    stdin?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error("Git command aborted"));
      }

      let isSettled = false;
      const proc = cp.spawn("git", args, {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });

      const cleanup = () => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          try {
            proc.kill();
          } catch {
            // ignore
          }
          reject(new Error(`Git command timed out: git ${args.join(" ")}`));
        }
      }, 5000);

      const onAbort = () => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          try {
            proc.kill();
          } catch {
            // ignore
          }
          reject(new Error("Git command aborted"));
        }
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const stdoutChunks: Buffer[] = [];
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      proc.on("error", (err) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          if (code === 0) {
            resolve(Buffer.concat(stdoutChunks).toString("utf8"));
          } else {
            reject(new Error(`Git exited with code ${code}: ${stderr}`));
          }
        }
      });

      if (stdin !== undefined) {
        proc.stdin.on("error", () => {
          // Swallow EPIPE in case git exited early
        });
        proc.stdin.write(stdin);
        proc.stdin.end();
      }
    });
  }
}

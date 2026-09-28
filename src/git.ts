import * as cp from "child_process";
import * as path from "path";
import { BlameInfo } from "./types";

export class GitService {
  private repoRootCache = new Map<string, string | null>();
  private remoteUrlCache = new Map<string, string | null>();
  private blameCache = new Map<string, BlameInfo>();

  /**
   * Clears the blame cache (e.g. on file save or document change).
   */
  public clearCache(filePath?: string) {
    if (filePath) {
      for (const key of this.blameCache.keys()) {
        if (key.startsWith(filePath)) {
          this.blameCache.delete(key);
        }
      }
    } else {
      this.blameCache.clear();
    }
  }

  /**
   * Disposes all git caches to release memory.
   */
  public dispose() {
    this.blameCache.clear();
    this.repoRootCache.clear();
    this.remoteUrlCache.clear();
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
   * Retrieves remote web URL for a commit (e.g. GitHub/GitLab).
   */
  public async getRemoteCommitUrl(
    repoRoot: string,
    sha: string,
  ): Promise<string | null> {
    if (sha.replace(/0/g, "").length === 0) {
      return null;
    }

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

    const remote = this.remoteUrlCache.get(repoRoot);
    if (!remote) {
      return null;
    }

    return this.formatCommitWebUrl(remote, sha);
  }

  /**
   * Converts a git remote URL into a web commit URL.
   */
  public formatCommitWebUrl(remoteUrl: string, sha: string): string | null {
    // Standardize git@host:owner/repo.git or https://host/owner/repo.git
    let clean = remoteUrl.trim();
    if (clean.endsWith(".git")) {
      clean = clean.slice(0, -4);
    }

    if (clean.startsWith("git@")) {
      const match = clean.match(/^git@([^:]+):(.+)$/);
      if (match) {
        const [, host, repoPath] = match;
        clean = `https://${host}/${repoPath}`;
      }
    }

    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      return null;
    }

    if (clean.includes("gitlab.com")) {
      return `${clean}/-/commit/${sha}`;
    }
    if (clean.includes("bitbucket.org")) {
      return `${clean}/commits/${sha}`;
    }
    // GitHub and others
    return `${clean}/commit/${sha}`;
  }

  /**
   * Blames a specific line (0-indexed).
   */
  public async getBlameForLine(
    filePath: string,
    line: number,
    documentVersion: number,
    documentText?: string,
    isDirty: boolean = false,
  ): Promise<BlameInfo | null> {
    const cacheKey = `${filePath}:${documentVersion}:${line}`;
    if (this.blameCache.has(cacheKey)) {
      return this.blameCache.get(cacheKey)!;
    }

    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot) {
      return null;
    }

    const lineNum = line + 1; // 1-indexed for git
    const args = ["blame"];

    if (isDirty && documentText !== undefined) {
      args.push("--contents", "-");
    }

    args.push("-L", `${lineNum},${lineNum}`, "--porcelain", "--", filePath);

    try {
      const output = await this.execGit(
        args,
        repoRoot,
        isDirty && documentText !== undefined ? documentText : undefined,
      );

      const blame = this.parsePorcelain(output, line, repoRoot);
      if (blame) {
        const remoteUrl = await this.getRemoteCommitUrl(repoRoot, blame.sha);
        if (remoteUrl) {
          blame.remoteCommitUrl = remoteUrl;
        }

        if (this.blameCache.size >= 500) {
          const oldestKey = this.blameCache.keys().next().value;
          if (oldestKey) {
            this.blameCache.delete(oldestKey);
          }
        }
        this.blameCache.set(cacheKey, blame);
      }
      return blame;
    } catch {
      return null;
    }
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
   * Parses `git blame --porcelain` single line output.
   */
  private parsePorcelain(
    output: string,
    line: number,
    repoRoot: string,
  ): BlameInfo | null {
    const lines = output.split("\n");
    if (lines.length === 0 || !lines[0]) {
      return null;
    }

    const firstLineParts = lines[0].trim().split(/\s+/);
    const sha = firstLineParts[0];
    if (!sha) {
      return null;
    }

    const isUncommitted = sha.replace(/0/g, "").length === 0;

    let author = "Unknown";
    let authorEmail = "";
    let authorTime = Math.floor(Date.now() / 1000);
    let authorTimeZone = "";
    let committer = "Unknown";
    let committerEmail = "";
    let committerTime = Math.floor(Date.now() / 1000);
    let summary = "";

    for (let i = 1; i < lines.length; i++) {
      const current = lines[i];
      if (current.startsWith("\t")) {
        break;
      }

      if (current.startsWith("author ")) {
        author = current.substring("author ".length).trim();
      } else if (current.startsWith("author-mail ")) {
        authorEmail = current
          .substring("author-mail ".length)
          .replace(/[<>]/g, "")
          .trim();
      } else if (current.startsWith("author-time ")) {
        authorTime = parseInt(
          current.substring("author-time ".length).trim(),
          10,
        );
      } else if (current.startsWith("author-tz ")) {
        authorTimeZone = current.substring("author-tz ".length).trim();
      } else if (current.startsWith("committer ")) {
        committer = current.substring("committer ".length).trim();
      } else if (current.startsWith("committer-mail ")) {
        committerEmail = current
          .substring("committer-mail ".length)
          .replace(/[<>]/g, "")
          .trim();
      } else if (current.startsWith("committer-time ")) {
        committerTime = parseInt(
          current.substring("committer-time ".length).trim(),
          10,
        );
      } else if (current.startsWith("summary ")) {
        summary = current.substring("summary ".length).trim();
      }
    }

    if (isUncommitted) {
      author = "You";
      summary = "Uncommitted changes";
    }

    return {
      sha,
      shortSha: isUncommitted ? "0000000" : sha.substring(0, 7),
      author,
      authorEmail,
      authorDate: new Date(authorTime * 1000),
      authorTimeZone,
      committer,
      committerEmail,
      committerDate: new Date(committerTime * 1000),
      summary,
      line,
      isUncommitted,
      repoRoot,
    };
  }

  /**
   * Helper to execute git command safely.
   */
  private execGit(
    args: string[],
    cwd: string,
    stdin?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let isSettled = false;
      const proc = cp.spawn("git", args, {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            proc.kill();
          } catch {
            // ignore
          }
          reject(new Error(`Git command timed out: git ${args.join(" ")}`));
        }
      }, 5000);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      proc.on("error", (err) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      proc.on("close", (code) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timer);
          if (code === 0) {
            resolve(stdout);
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

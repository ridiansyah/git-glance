import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import { BlameInfo, BlameRequest, GitServiceOptions } from "./types";

const FULL_BLAME_MAX_LINES = 2500;
const CACHE_LIMIT = 5000;
const UNCOMMITTED_SHA = "0".repeat(40);

export type GitErrorKind = "aborted" | "timeout" | "exit" | "spawn";

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly kind: GitErrorKind,
    public readonly stderr: string = "",
  ) {
    super(message);
  }
}

export interface GitServiceTimeouts {
  fullBlameMs: number;
  lineBlameMs: number;
  defaultMs: number;
}

interface ExecOptions {
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingFullBlame {
  promise: Promise<Map<number, BlameInfo>>;
  controller: AbortController;
}

interface BlameContext {
  filePath: string;
  repoRoot: string;
  isDirty: boolean;
  currentUserEmail: string | null;
  rawRemote: string | null;
  ignoreRevsFile: string | null;
}

/**
 * Builds the blame shown for a line the user is editing right now, without running git.
 */
export function createUncommittedBlame(
  line: number,
  repoRoot?: string,
  date: Date = new Date(),
): BlameInfo {
  return {
    sha: UNCOMMITTED_SHA,
    shortSha: "0000000",
    author: "You",
    authorEmail: "not.committed.yet",
    authorDate: date,
    authorTimeZone: "",
    committer: "You",
    committerEmail: "not.committed.yet",
    committerDate: date,
    summary: "Uncommitted changes",
    line,
    isUncommitted: true,
    isCurrentUser: true,
    repoRoot,
  };
}

function isErrorKind(err: unknown, ...kinds: GitErrorKind[]): boolean {
  return err instanceof GitCommandError && kinds.includes(err.kind);
}

export class GitService {
  private repoRootCache = new Map<string, string | null>();
  private remoteUrlCache = new Map<string, string | null>();
  private currentUserEmailCache = new Map<string, string | null>();
  private ignoreRevsCache = new Map<string, string | null>();
  /** Repos whose ignore-revs file made git fail; blamed without it from then on. */
  private brokenIgnoreRevs = new Set<string>();

  private blameCache = new Map<string, BlameInfo>();
  private blameCacheByFile = new Map<string, Set<string>>();
  private cacheKeyToFile = new Map<string, string>();
  private pendingFullBlame = new Map<string, PendingFullBlame>();
  /** Holds `${file}:${version}` (whole file failed) and `${file}:${version}:${line}` (one line failed). */
  private failedBlame = new Set<string>();
  /** Files whose whole-file blame timed out; they use single-line blame from then on. */
  private slowFullBlameFiles = new Set<string>();

  // Results that finish after a cache clear must not be written back.
  private globalGeneration = 0;
  private fileGeneration = new Map<string, number>();

  private options: GitServiceOptions = {
    remoteName: "",
    useIgnoreRevsFile: true,
  };
  private timeouts: GitServiceTimeouts;

  constructor(timeouts: Partial<GitServiceTimeouts> = {}) {
    this.timeouts = {
      fullBlameMs: 5000,
      lineBlameMs: 10000,
      defaultMs: 5000,
      ...timeouts,
    };
  }

  public setOptions(options: GitServiceOptions) {
    if (
      options.remoteName === this.options.remoteName &&
      options.useIgnoreRevsFile === this.options.useIgnoreRevsFile
    ) {
      return;
    }
    this.options = { ...options };
    this.clearCache();
  }

  /**
   * Clears blame results for one file, or everything when no file is given.
   */
  public clearCache(filePath?: string) {
    if (filePath === undefined) {
      this.globalGeneration++;
      for (const pending of this.pendingFullBlame.values()) {
        pending.controller.abort();
      }
      this.pendingFullBlame.clear();
      this.blameCache.clear();
      this.blameCacheByFile.clear();
      this.cacheKeyToFile.clear();
      this.failedBlame.clear();
      this.currentUserEmailCache.clear();
      this.remoteUrlCache.clear();
      this.ignoreRevsCache.clear();
      this.brokenIgnoreRevs.clear();
      return;
    }

    const current = this.fileGeneration.get(filePath);
    this.fileGeneration.set(filePath, current === undefined ? 1 : current + 1);

    const keys = this.blameCacheByFile.get(filePath);
    if (keys) {
      for (const key of keys) {
        this.blameCache.delete(key);
        this.cacheKeyToFile.delete(key);
      }
      this.blameCacheByFile.delete(filePath);
    }

    const prefix = `${filePath}:`;
    for (const key of this.failedBlame) {
      if (key.startsWith(prefix)) {
        this.failedBlame.delete(key);
      }
    }
    for (const [key, pending] of this.pendingFullBlame) {
      if (key.startsWith(prefix)) {
        pending.controller.abort();
        this.pendingFullBlame.delete(key);
      }
    }
  }

  /**
   * Clears blame results for every file inside a repository (e.g. after HEAD moved).
   */
  public clearRepoCache(repoRoot: string) {
    const prefix = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
    const files = new Set<string>(this.blameCacheByFile.keys());
    for (const key of [...this.failedBlame, ...this.pendingFullBlame.keys()]) {
      files.add(this.fileOfKey(key));
    }
    for (const file of files) {
      if (file.startsWith(prefix)) {
        this.clearCache(file);
      }
    }
    // Small per-repo lookups; rebuilding them costs one git call each.
    this.currentUserEmailCache.clear();
    this.remoteUrlCache.clear();
    this.ignoreRevsCache.clear();
    this.brokenIgnoreRevs.clear();
  }

  public dispose() {
    this.clearCache();
    this.repoRootCache.clear();
    this.slowFullBlameFiles.clear();
    this.fileGeneration.clear();
  }

  /**
   * Checks whether the blame for the given file, version, and line is already cached.
   */
  public hasCachedBlame(
    filePath: string,
    documentVersion: number,
    line: number,
  ): boolean {
    return this.touchCache(`${filePath}:${documentVersion}:${line}`) !== undefined;
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
   * Retrieves the URL of the configured remote (`origin` or the first remote by default).
   */
  public async getRemoteBaseUrl(repoRoot: string): Promise<string | null> {
    if (this.remoteUrlCache.has(repoRoot)) {
      return this.remoteUrlCache.get(repoRoot)!;
    }

    let url: string | null = null;
    const remoteName = await this.resolveRemoteName(repoRoot);
    if (remoteName !== null) {
      try {
        const output = (
          await this.execGit(["remote", "get-url", remoteName], repoRoot)
        ).trim();
        if (output.length > 0) {
          url = output;
        }
      } catch {
        // Remote doesn't exist
      }
    }

    this.remoteUrlCache.set(repoRoot, url);
    return url;
  }

  private async resolveRemoteName(repoRoot: string): Promise<string | null> {
    if (this.options.remoteName.length > 0) {
      return this.options.remoteName;
    }
    try {
      const remotes = (await this.execGit(["remote"], repoRoot))
        .split("\n")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (remotes.includes("origin")) {
        return "origin";
      }
      return remotes.length > 0 ? remotes[0] : null;
    } catch {
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
   * Blames one line (0-indexed). Files up to 2500 lines are blamed whole once per
   * document version (dirty buffers via `--contents -`); larger files, and files whose
   * whole-file blame timed out, use `-L <line>,<line>`.
   */
  public async getBlameForLine(
    request: BlameRequest,
    signal?: AbortSignal,
  ): Promise<BlameInfo | null> {
    const { filePath, line, documentVersion, lineCount, isDirty } = request;
    const fileVersionKey = `${filePath}:${documentVersion}`;
    const cacheKey = `${fileVersionKey}:${line}`;

    const cached = this.touchCache(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    if (
      signal?.aborted ||
      this.failedBlame.has(fileVersionKey) ||
      this.failedBlame.has(cacheKey)
    ) {
      return null;
    }

    // Read before any await so the text matches documentVersion.
    const contents = isDirty ? request.getText() : undefined;
    const generation = this.generationOf(filePath);

    const repoRoot = await this.getRepoRoot(filePath);
    if (!repoRoot || signal?.aborted) {
      return null;
    }

    const [currentUserEmail, rawRemote, ignoreRevsFile] = await Promise.all([
      this.getCurrentUserEmail(repoRoot),
      this.getRemoteBaseUrl(repoRoot),
      this.getIgnoreRevsFile(repoRoot),
    ]);
    if (signal?.aborted) {
      return null;
    }

    const context: BlameContext = {
      filePath,
      repoRoot,
      isDirty,
      currentUserEmail,
      rawRemote,
      ignoreRevsFile,
    };

    if (
      lineCount <= FULL_BLAME_MAX_LINES &&
      !this.slowFullBlameFiles.has(filePath)
    ) {
      try {
        const map = await this.getFullBlame(
          fileVersionKey,
          contents,
          context,
          generation,
        );
        if (signal?.aborted) {
          return null;
        }
        const blame = map.get(line);
        return blame === undefined ? null : blame;
      } catch (err) {
        if (signal?.aborted || isErrorKind(err, "aborted")) {
          return null;
        }
        if (!isErrorKind(err, "timeout")) {
          this.markFailed(filePath, fileVersionKey, generation);
          return null;
        }
        // Deep history: fall through to single-line blame for this file.
        this.slowFullBlameFiles.add(filePath);
      }
    }

    try {
      const lineNum = line + 1; // git blame is 1-indexed
      const output = await this.runBlame(
        context,
        ["-L", `${lineNum},${lineNum}`],
        contents,
        signal,
        this.timeouts.lineBlameMs,
      );
      if (signal?.aborted) {
        return null;
      }

      const blame = this.parsePorcelain(output, repoRoot).get(line);
      if (blame === undefined) {
        return null;
      }

      const uncommittedDate =
        blame.isUncommitted && !isDirty
          ? await this.readMtime(filePath)
          : undefined;
      this.enrich(blame, context, uncommittedDate);

      if (this.generationOf(filePath) === generation) {
        this.setBlameCache(filePath, cacheKey, blame);
      }
      return blame;
    } catch (err) {
      if (signal?.aborted || isErrorKind(err, "aborted", "timeout")) {
        return null;
      }
      // "has only N lines": the cursor is on the trailing empty line, not a broken file.
      const lineOnly =
        err instanceof GitCommandError && /has only \d+ lines?/.test(err.stderr);
      this.markFailed(filePath, lineOnly ? cacheKey : fileVersionKey, generation);
      return null;
    }
  }

  private getFullBlame(
    fileVersionKey: string,
    contents: string | undefined,
    context: BlameContext,
    generation: string,
  ): Promise<Map<number, BlameInfo>> {
    const existing = this.pendingFullBlame.get(fileVersionKey);
    if (existing) {
      return existing.promise;
    }

    const { filePath } = context;
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const output = await this.runBlame(
          context,
          [],
          contents,
          controller.signal,
          this.timeouts.fullBlameMs,
        );
        const map = this.parsePorcelain(output, context.repoRoot);

        let uncommittedDate: Date | undefined;
        if (!context.isDirty) {
          for (const blame of map.values()) {
            if (blame.isUncommitted) {
              uncommittedDate = await this.readMtime(filePath);
              break;
            }
          }
        }

        const isCurrent = this.generationOf(filePath) === generation;
        for (const blame of map.values()) {
          this.enrich(blame, context, uncommittedDate);
          if (isCurrent) {
            this.setBlameCache(filePath, `${fileVersionKey}:${blame.line}`, blame);
          }
        }
        return map;
      } finally {
        if (this.pendingFullBlame.get(fileVersionKey)?.controller === controller) {
          this.pendingFullBlame.delete(fileVersionKey);
        }
      }
    })();

    this.pendingFullBlame.set(fileVersionKey, { promise, controller });
    return promise;
  }

  private async runBlame(
    context: BlameContext,
    extraArgs: string[],
    contents: string | undefined,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<string> {
    const { repoRoot, filePath, ignoreRevsFile } = context;
    const useIgnoreRevs =
      ignoreRevsFile !== null && !this.brokenIgnoreRevs.has(repoRoot);

    const buildArgs = (withIgnoreRevs: boolean): string[] => {
      const args = ["blame", "--porcelain", ...extraArgs];
      if (contents !== undefined) {
        args.push("--contents", "-");
      }
      if (withIgnoreRevs && ignoreRevsFile !== null) {
        args.push("--ignore-revs-file", ignoreRevsFile);
      }
      args.push("--", filePath);
      return args;
    };

    const execOptions: ExecOptions = { stdin: contents, signal, timeoutMs };
    try {
      return await this.execGit(buildArgs(useIgnoreRevs), repoRoot, execOptions);
    } catch (err) {
      // A malformed line in the ignore-revs file makes git exit before blaming.
      const ignoreRevsRejected =
        useIgnoreRevs &&
        err instanceof GitCommandError &&
        err.kind === "exit" &&
        /invalid object name|could not open object name list/.test(err.stderr);
      if (!ignoreRevsRejected) {
        throw err;
      }
      this.brokenIgnoreRevs.add(repoRoot);
      return this.execGit(buildArgs(false), repoRoot, execOptions);
    }
  }

  /**
   * Fills the fields that need repository context: current user, remote link, and
   * the on-disk mtime for saved-but-uncommitted lines (git reports "now" for those).
   */
  private enrich(
    blame: BlameInfo,
    context: BlameContext,
    uncommittedDate: Date | undefined,
  ) {
    if (blame.isUncommitted && uncommittedDate !== undefined) {
      blame.authorDate = uncommittedDate;
      blame.committerDate = uncommittedDate;
    }

    blame.isCurrentUser =
      blame.isUncommitted ||
      this.isCurrentUser(blame.authorEmail, context.currentUserEmail);

    if (context.rawRemote !== null && !blame.isUncommitted) {
      const remoteUrl = this.formatCommitWebUrl(context.rawRemote, blame.sha);
      if (remoteUrl !== null) {
        blame.remoteCommitUrl = remoteUrl;
      }
    }
  }

  private async readMtime(filePath: string): Promise<Date | undefined> {
    try {
      return (await fs.promises.stat(filePath)).mtime;
    } catch {
      return undefined;
    }
  }

  private async getIgnoreRevsFile(repoRoot: string): Promise<string | null> {
    if (!this.options.useIgnoreRevsFile) {
      return null;
    }
    if (this.ignoreRevsCache.has(repoRoot)) {
      return this.ignoreRevsCache.get(repoRoot)!;
    }

    const candidate = path.join(repoRoot, ".git-blame-ignore-revs");
    let resolved: string | null = null;
    try {
      await fs.promises.access(candidate, fs.constants.R_OK);
      resolved = candidate;
    } catch {
      // No ignore-revs file in this repository
    }
    this.ignoreRevsCache.set(repoRoot, resolved);
    return resolved;
  }

  private markFailed(filePath: string, key: string, generation: string) {
    if (this.generationOf(filePath) === generation) {
      this.failedBlame.add(key);
    }
  }

  private generationOf(filePath: string): string {
    const fileGen = this.fileGeneration.get(filePath);
    return `${this.globalGeneration}:${fileGen === undefined ? 0 : fileGen}`;
  }

  /** Cache keys look like `${file}:${version}` or `${file}:${version}:${line}`. */
  private fileOfKey(key: string): string {
    const versionAt = key.match(/:\d+(?::\d+)?$/);
    return versionAt === null || versionAt.index === undefined
      ? key
      : key.slice(0, versionAt.index);
  }

  /** Returns a cached entry and marks it most recently used. */
  private touchCache(cacheKey: string): BlameInfo | undefined {
    const cached = this.blameCache.get(cacheKey);
    if (cached !== undefined) {
      this.blameCache.delete(cacheKey);
      this.blameCache.set(cacheKey, cached);
    }
    return cached;
  }

  /**
   * Sets blame into memory cache with LRU eviction guard.
   */
  private setBlameCache(filePath: string, key: string, blame: BlameInfo) {
    if (this.blameCache.size >= CACHE_LIMIT) {
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

    let email: string | null = null;
    try {
      const configured = (await this.execGit(["config", "user.email"], repoRoot))
        .trim()
        .replace(/^["']|["']$/g, "");
      if (configured.length > 0) {
        email = configured;
      }
    } catch {
      // git exits with 1 when user.email is unset
    }

    if (email === null) {
      const envEmail = process.env.GIT_AUTHOR_EMAIL;
      if (envEmail !== undefined && envEmail.length > 0) {
        email = envEmail;
      }
    }

    this.currentUserEmailCache.set(repoRoot, email);
    return email;
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
   * Runs git with a timeout, optional stdin, and AbortSignal cancellation.
   * Rejects with a GitCommandError whose `kind` tells callers whether a retry makes sense.
   */
  private execGit(
    args: string[],
    cwd: string,
    options: ExecOptions = {},
  ): Promise<string> {
    const { stdin, signal } = options;
    const timeoutMs =
      options.timeoutMs === undefined ? this.timeouts.defaultMs : options.timeoutMs;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new GitCommandError("Git command aborted", "aborted"));
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

      const settle = (error: GitCommandError | null, output?: string) => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        if (error) {
          if (error.kind === "aborted" || error.kind === "timeout") {
            try {
              proc.kill();
            } catch {
              // ignore
            }
          }
          reject(error);
        } else {
          resolve(output === undefined ? "" : output);
        }
      };

      const timer = setTimeout(() => {
        settle(
          new GitCommandError(`Git command timed out: git ${args.join(" ")}`, "timeout"),
        );
      }, timeoutMs);

      const onAbort = () => {
        settle(new GitCommandError("Git command aborted", "aborted"));
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
        settle(new GitCommandError(err.message, "spawn"));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          settle(null, Buffer.concat(stdoutChunks).toString("utf8"));
        } else {
          settle(
            new GitCommandError(`Git exited with code ${code}: ${stderr}`, "exit", stderr),
          );
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

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import { ParsedRemote, detectProvider } from "./remote";

const AVATAR_COLORS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#14b8a6", // Teal
  "#a855f7", // Purple
];

const FETCH_TIMEOUT_MS = 2500;
const MEMORY_CACHE_LIMIT = 200;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AvatarReadyListener = (key: string, avatarPath: string) => void;

/**
 * Returns a GitHub token for `host`, or null. With `requestSignIn`, the user is
 * asked to sign in (without a modal) when no session exists yet.
 */
export type GitHubTokenProvider = (
  host: string,
  requestSignIn: boolean,
) => Promise<string | null>;

export interface AvatarCommit {
  sha: string;
  remote?: ParsedRemote;
}

/**
 * A photo URL, "none" when the source answered that there is no photo, or "retry"
 * when the answer may change later (offline, rate limited, not signed in).
 */
type Lookup = { url: string } | "none" | "retry";

export class AvatarService {
  private avatarDir: string;
  private memoryCache = new Map<string, string>();
  private fetchingSet = new Set<string>();
  /** Epoch ms until which a GitHub host refuses requests, keyed by `host` + signed-in state. */
  private rateLimitedUntil = new Map<string, number>();
  /** Session cache of a repository's recent commit authors, keyed by repository API URL. */
  private githubRecentAuthors = new Map<string, Promise<Map<string, string | null> | null>>();
  private listeners: AvatarReadyListener[] = [];

  constructor(
    storagePath?: string,
    private getGitHubToken?: GitHubTokenProvider,
    private log: (message: string) => void = () => {},
  ) {
    let dir = "";
    if (storagePath) {
      try {
        dir = path.join(storagePath, "avatars");
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch {
        dir = "";
      }
    }

    if (!dir) {
      dir = path.join(os.tmpdir(), "git-glance-avatars");
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch {
        // ignore
      }
    }

    this.avatarDir = dir;
  }

  /**
   * Registers a listener triggered whenever a background avatar download completes.
   */
  public onAvatarReady(listener: AvatarReadyListener): { dispose: () => void } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  }

  private notifyAvatarReady(key: string, avatarPath: string) {
    for (const listener of this.listeners) {
      try {
        listener(key, avatarPath);
      } catch {
        // ignore listener errors
      }
    }
  }

  /**
   * Computes the unique cache key for a given blame identity.
   */
  public getAvatarKey(
    author: string,
    email: string,
    isUncommitted: boolean,
  ): string {
    if (isUncommitted) {
      return "__you__";
    }
    const cleanEmail = email.toLowerCase().trim();
    if (cleanEmail.length > 0) {
      return cleanEmail;
    }
    const cleanAuthor = author.toLowerCase().trim();
    return cleanAuthor.length > 0 ? cleanAuthor : "unknown";
  }

  /**
   * Retrieves or generates a local avatar file path for the given author.
   * With `allowRemote` false, only the local initials badge is used and nothing is fetched.
   */
  public getAvatarPath(
    author: string,
    email: string,
    isUncommitted: boolean,
    allowRemote: boolean,
    commit?: AvatarCommit,
  ): string | null {
    if (isUncommitted) {
      return this.getYouAvatarPath();
    }

    const key = this.getAvatarKey(author, email, isUncommitted);
    const memoryKey = allowRemote ? key : `initials:${key}`;
    if (this.memoryCache.has(memoryKey)) {
      return this.memoryCache.get(memoryKey)!;
    }

    const hash = crypto.createHash("md5").update(key).digest("hex");
    const photoSvgPath = path.join(this.avatarDir, `${hash}_photo_v6.svg`);
    const initialsSvgPath = path.join(
      this.avatarDir,
      `${hash}_initials_v6.svg`,
    );
    const notFoundPath = path.join(this.avatarDir, `${hash}_none_v6`);

    // 1. If photo SVG was already downloaded and wrapped, use it!
    if (allowRemote && fs.existsSync(photoSvgPath)) {
      this.remember(memoryKey, photoSvgPath);
      return photoSvgPath;
    }

    // 2. Ensure compact 14x14 initials SVG exists
    if (!fs.existsSync(initialsSvgPath)) {
      try {
        const svgContent = this.generateInitialsSvg(author, key);
        fs.writeFileSync(initialsSvgPath, svgContent, "utf8");
      } catch {
        return null;
      }
    }

    this.remember(memoryKey, initialsSvgPath);

    // 3. Fetch the photo in the background, unless a recent lookup found none
    if (
      allowRemote &&
      !this.fetchingSet.has(key) &&
      !this.isRecentlyNotFound(notFoundPath)
    ) {
      this.fetchingSet.add(key);
      this.fetchRemoteAvatar(email, photoSvgPath, notFoundPath, key, commit);
    }

    return initialsSvgPath;
  }

  private remember(key: string, avatarPath: string) {
    if (this.memoryCache.size >= MEMORY_CACHE_LIMIT) {
      const oldest = this.memoryCache.keys().next();
      if (!oldest.done) {
        this.memoryCache.delete(oldest.value);
      }
    }
    this.memoryCache.set(key, avatarPath);
  }

  private isRecentlyNotFound(notFoundPath: string): boolean {
    try {
      return Date.now() - fs.statSync(notFoundPath).mtimeMs < NOT_FOUND_TTL_MS;
    } catch {
      return false;
    }
  }

  /**
   * Generates a compact, friendly 14x14 avatar for uncommitted edits.
   */
  private getYouAvatarPath(): string | null {
    const youPath = path.join(this.avatarDir, "you_v5.svg");
    if (this.memoryCache.has("__you__")) {
      return this.memoryCache.get("__you__")!;
    }

    if (!fs.existsSync(youPath)) {
      try {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14">
  <defs>
    <linearGradient id="glance-you-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#818cf8" />
    </linearGradient>
  </defs>
  <circle cx="7" cy="7" r="7" fill="url(#glance-you-grad)" />
  <path d="M7 3.5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm-3.2 6.5c0-1.5 1.5-2.4 3.2-2.4s3.2 0.9 3.2 2.4v0.4H3.8V10z" fill="#ffffff" />
</svg>`;
        fs.writeFileSync(youPath, svg, "utf8");
      } catch {
        return null;
      }
    }

    this.remember("__you__", youPath);
    return youPath;
  }

  /**
   * Generates a crisp, circular 14x14 SVG badge with user initials.
   */
  public generateInitialsSvg(name: string, seed: string): string {
    const initials = this.extractInitials(name);
    const bgColor = this.pickColor(seed);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14">
  <circle cx="7" cy="7" r="7" fill="${bgColor}" />
  <text x="7" y="7.2" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="6.5" font-weight="700" letter-spacing="-0.3">${initials}</text>
</svg>`;
  }

  /**
   * Wraps downloaded raster image bytes into a circular 14x14 SVG wrapper.
   */
  public wrapImageInSvg(base64Data: string, mimeType: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14">
  <defs>
    <clipPath id="avatarClip">
      <circle cx="7" cy="7" r="7" />
    </clipPath>
  </defs>
  <image href="data:${mimeType};base64,${base64Data}" width="14" height="14" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />
  <circle cx="7" cy="7" r="6.6" fill="none" stroke="#ffffff22" stroke-width="0.8" />
</svg>`;
  }

  /**
   * Extracts 1-2 uppercase initials from a person's name.
   */
  public extractInitials(name: string): string {
    const clean = name.trim().replace(/[^\p{L}\s]/gu, "");
    if (!clean) return "GL";

    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "GL";
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  private pickColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  /**
   * Fetches the author photo in the background. Only sources tied to the commit
   * email are used, so a photo always belongs to the commit's author:
   *   1. GitHub noreply email → that GitHub user
   *   2. The repository host: GitHub / GitHub Enterprise commit API, GitLab avatar
   *      API, Bitbucket Cloud or Gitea/Forgejo commit API
   *   3. Gravatar for the email
   * When every source answers "no photo", that's remembered on disk for a week.
   */
  private async fetchRemoteAvatar(
    email: string,
    targetSvgPath: string,
    notFoundPath: string,
    key: string,
    commit?: AvatarCommit,
  ) {
    const cleanEmail = email.toLowerCase().trim();
    let shouldRetry = false;

    const candidates: Array<() => Promise<Lookup>> = [];

    const noreplyMatch = cleanEmail.match(
      /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/,
    );
    if (noreplyMatch !== null) {
      const username = noreplyMatch[1];
      candidates.push(async () => ({
        url: `https://github.com/${encodeURIComponent(username)}.png?size=28`,
      }));
    }

    const remote = commit?.remote;
    if (noreplyMatch === null && remote !== undefined && commit !== undefined) {
      const lookup = this.hostLookup(remote, commit.sha, cleanEmail);
      if (lookup !== null) {
        candidates.push(lookup);
      }
    }

    if (cleanEmail.length > 0 && !cleanEmail.includes("noreply")) {
      const hash = crypto.createHash("md5").update(cleanEmail).digest("hex");
      candidates.push(async () => ({
        url: `https://www.gravatar.com/avatar/${hash}?s=28&d=404`,
      }));
    }

    for (const lookup of candidates) {
      try {
        const result = await lookup();
        if (result === "retry") {
          shouldRetry = true;
          continue;
        }
        if (result === "none") {
          continue;
        }
        const response = await this.fetchWithTimeout(result.url);
        if (response === null) {
          shouldRetry = true;
          continue;
        }
        if (!response.ok) {
          if (!result.url.startsWith("https://www.gravatar.com/")) {
            this.log(`Avatar ${cleanEmail}: ${new URL(result.url).host} answered ${response.status}`);
          }
          continue;
        }
        const header = response.headers.get("content-type");
        const contentType = header === null ? "image/png" : header;
        if (!contentType.startsWith("image/")) {
          continue;
        }
        const base64Data = Buffer.from(await response.arrayBuffer()).toString(
          "base64",
        );
        await fs.promises.writeFile(
          targetSvgPath,
          this.wrapImageInSvg(base64Data, contentType),
          "utf8",
        );
        this.remember(key, targetSvgPath);
        this.notifyAvatarReady(key, targetSvgPath);
        this.log(`Avatar ${cleanEmail}: photo from ${new URL(result.url).host}`);
        return;
      } catch (error) {
        this.log(`Avatar ${cleanEmail}: lookup failed (${String(error)})`);
        shouldRetry = true;
      }
    }

    this.log(
      shouldRetry
        ? `Avatar ${cleanEmail}: no photo yet, retrying next session`
        : `Avatar ${cleanEmail}: no photo found, showing initials for a week`,
    );

    // Offline, rate limited or not signed in: try again next session instead of for a week.
    if (!shouldRetry) {
      try {
        fs.writeFileSync(notFoundPath, "", "utf8");
      } catch {
        // ignore
      }
    }
  }

  /** Picks the photo lookup offered by the repository host, if it has one. */
  private hostLookup(
    remote: ParsedRemote,
    sha: string,
    email: string,
  ): (() => Promise<Lookup>) | null {
    const baseUrl = `${remote.scheme}//${remote.host}${remote.port ? `:${remote.port}` : ""}`;
    const segments = remote.path.split("/");
    const owner = segments[segments.length - 2];
    const repo = segments[segments.length - 1];

    switch (detectProvider(remote)) {
      case "github": {
        if (owner === undefined) {
          return null;
        }
        const apiBase =
          remote.host === "github.com" ? "https://api.github.com" : `${baseUrl}/api/v3`;
        return () =>
          this.lookupGitHub(remote.host, `${apiBase}/repos/${owner}/${repo}`, sha, email);
      }
      case "gitlab": {
        if (email.length === 0) {
          return null;
        }
        return () =>
          this.lookupJson(
            `${baseUrl}/api/v4/avatar?email=${encodeURIComponent(email)}&size=28`,
            (body) => {
              const url = (body as { avatar_url?: unknown }).avatar_url;
              // GitLab falls back to a Gravatar identicon; the Gravatar lookup below handles that email.
              return typeof url === "string" && !url.includes("gravatar.com") ? url : null;
            },
          );
      }
      case "bitbucket-cloud": {
        if (owner === undefined) {
          return null;
        }
        return () =>
          this.lookupJson(
            `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/commit/${sha}`,
            (body) => {
              const href = (
                body as { author?: { user?: { links?: { avatar?: { href?: unknown } } } } }
              ).author?.user?.links?.avatar?.href;
              return typeof href === "string" ? href : null;
            },
          );
      }
      case "generic": {
        if (owner === undefined) {
          return null;
        }
        // Gitea, Forgejo and Codeberg; other hosts answer 404 and fall through to Gravatar.
        return () =>
          this.lookupJson(
            `${baseUrl}/api/v1/repos/${owner}/${repo}/git/commits/${sha}`,
            (body) => {
              const url = (body as { author?: { avatar_url?: unknown } | null }).author
                ?.avatar_url;
              return typeof url === "string" ? url : null;
            },
          );
      }
      default:
        return null;
    }
  }

  /**
   * Looks the author up in the repository's 100 most recent commits (one request
   * fills many authors), then in the blamed commit itself. GitHub answers 404 for
   * private repositories without a token, so that answer never means "no photo".
   */
  private async lookupGitHub(
    host: string,
    repoApiUrl: string,
    sha: string,
    email: string,
  ): Promise<Lookup> {
    const token =
      this.getGitHubToken === undefined ? null : await this.getGitHubToken(host, false);

    if (email.length > 0) {
      let recent = this.githubRecentAuthors.get(repoApiUrl);
      if (recent === undefined) {
        recent = this.fetchGitHub(host, `${repoApiUrl}/commits?per_page=100`, token).then(
          (body) => {
            if (!Array.isArray(body)) {
              this.githubRecentAuthors.delete(repoApiUrl);
              return null;
            }
            return this.authorsByEmail(body);
          },
        );
        this.githubRecentAuthors.set(repoApiUrl, recent);
      }
      const authors = await recent;
      if (authors !== null && authors.has(email)) {
        return this.githubAvatar(host, authors.get(email)!);
      }
    }

    const body = await this.fetchGitHub(host, `${repoApiUrl}/commits/${sha}`, token);
    if (body === null) {
      return "retry";
    }
    const author = (body as { author?: { avatar_url?: unknown } | null }).author;
    return this.githubAvatar(
      host,
      typeof author?.avatar_url === "string" ? author.avatar_url : null,
    );
  }

  /** Maps each commit email to its GitHub avatar URL, or null when no account is linked. */
  private authorsByEmail(commits: unknown[]): Map<string, string | null> {
    const authors = new Map<string, string | null>();
    for (const item of commits) {
      const commit = item as {
        commit?: { author?: { email?: unknown } };
        author?: { avatar_url?: unknown } | null;
      };
      const commitEmail = commit.commit?.author?.email;
      if (typeof commitEmail !== "string") {
        continue;
      }
      const avatarUrl = commit.author?.avatar_url;
      const key = commitEmail.toLowerCase().trim();
      if (typeof avatarUrl === "string") {
        authors.set(key, avatarUrl);
      } else if (!authors.has(key)) {
        authors.set(key, null);
      }
    }
    return authors;
  }

  private githubAvatar(host: string, avatarUrl: string | null): Lookup {
    if (avatarUrl === null) {
      this.log(`Avatar: ${host} has no account linked to this commit's email`);
      return "none";
    }
    const url = new URL(avatarUrl);
    url.searchParams.set("s", "28");
    return { url: url.toString() };
  }

  /** GitHub API GET; null when the answer may change later (offline, rate limited, no access). */
  private async fetchGitHub(
    host: string,
    apiUrl: string,
    token: string | null,
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (token !== null) {
      headers.authorization = `Bearer ${token}`;
    }

    const limitKey = `${host}:${token === null ? "anonymous" : "signed-in"}`;
    const limitedUntil = this.rateLimitedUntil.get(limitKey);
    if (limitedUntil !== undefined && Date.now() < limitedUntil) {
      return null;
    }

    const response = await this.fetchWithTimeout(apiUrl, headers);
    if (response === null) {
      this.log(`Avatar: ${host} API unreachable`);
      return null;
    }
    if (!response.ok) {
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
      if (rateLimited) {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        this.rateLimitedUntil.set(
          limitKey,
          Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + 60 * 60 * 1000,
        );
      }
      this.log(
        `Avatar: ${host} API answered ${response.status}${rateLimited ? " (rate limited)" : ""} ${token === null ? "(no GitHub token)" : "(with token)"}`,
      );
      // A token lifts both: private repositories (401/404) and the 60 requests/hour anonymous limit.
      if (
        (token === null && [401, 403, 404, 429].includes(response.status)) ||
        response.status === 401
      ) {
        void this.getGitHubToken?.(host, true);
      }
      // 404/422 with a token = commit not pushed yet
      return null;
    }
    return response.json();
  }

  private async lookupJson(
    apiUrl: string,
    pickUrl: (body: unknown) => string | null,
  ): Promise<Lookup> {
    const response = await this.fetchWithTimeout(apiUrl, { accept: "application/json" });
    if (response === null) {
      return "retry";
    }
    if (!response.ok) {
      return response.status === 429 ? "retry" : "none";
    }
    const url = pickUrl(await response.json());
    return url === null ? "none" : { url };
  }

  /**
   * Forgets this session's lookups so authors get looked up again, e.g. after
   * signing in to GitHub.
   */
  public resetLookups() {
    this.memoryCache.clear();
    this.fetchingSet.clear();
    this.githubRecentAuthors.clear();
  }

  /** Resolves to null on network errors and timeouts. */
  private async fetchWithTimeout(
    url: string,
    headers?: Record<string, string>,
  ): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Cleans up in-memory caches and listeners.
   */
  public dispose() {
    this.memoryCache.clear();
    this.fetchingSet.clear();
    this.listeners = [];
  }
}

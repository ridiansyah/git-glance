import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";

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

export class AvatarService {
  private avatarDir: string;
  private memoryCache = new Map<string, string>();
  private fetchingSet = new Set<string>();
  private listeners: AvatarReadyListener[] = [];

  constructor(storagePath?: string) {
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
    remoteCommitUrl?: string,
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
    const photoSvgPath = path.join(this.avatarDir, `${hash}_photo_v5.svg`);
    const initialsSvgPath = path.join(
      this.avatarDir,
      `${hash}_initials_v5.svg`,
    );
    const notFoundPath = path.join(this.avatarDir, `${hash}_none_v5`);

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
      this.fetchRemoteAvatar(email, photoSvgPath, notFoundPath, key, remoteCommitUrl);
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
   *   2. GitHub commit API (github.com remotes) → the account GitHub linked to the email
   *   3. Gravatar for the email
   * When every source answers "no photo", that's remembered on disk for a week.
   */
  private async fetchRemoteAvatar(
    email: string,
    targetSvgPath: string,
    notFoundPath: string,
    key: string,
    remoteCommitUrl?: string,
  ) {
    const cleanEmail = email.toLowerCase().trim();
    let hadNetworkError = false;

    const candidates: Array<() => Promise<string | null>> = [];

    const noreplyMatch = cleanEmail.match(
      /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/,
    );
    if (noreplyMatch !== null) {
      const username = noreplyMatch[1];
      candidates.push(async () =>
        `https://github.com/${encodeURIComponent(username)}.png?size=28`,
      );
    }

    const githubCommit =
      remoteCommitUrl === undefined
        ? null
        : remoteCommitUrl.match(
            /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]+)$/,
          );
    if (noreplyMatch === null && githubCommit !== null) {
      const [, owner, repo, sha] = githubCommit;
      candidates.push(async () => {
        const response = await this.fetchWithTimeout(
          `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
          { accept: "application/vnd.github+json" },
        );
        if (response === null) {
          hadNetworkError = true;
          return null;
        }
        if (!response.ok) {
          // 403 = rate limited: not a definitive "no photo"
          if (response.status === 403 || response.status === 429) {
            hadNetworkError = true;
          }
          return null;
        }
        const body = (await response.json()) as {
          author?: { avatar_url?: unknown } | null;
        };
        const avatarUrl = body.author?.avatar_url;
        if (typeof avatarUrl !== "string") {
          return null;
        }
        const url = new URL(avatarUrl);
        url.searchParams.set("s", "28");
        return url.toString();
      });
    }

    if (cleanEmail.length > 0 && !cleanEmail.includes("noreply")) {
      const hash = crypto.createHash("md5").update(cleanEmail).digest("hex");
      candidates.push(async () =>
        `https://www.gravatar.com/avatar/${hash}?s=28&d=404`,
      );
    }

    for (const resolveUrl of candidates) {
      try {
        const url = await resolveUrl();
        if (url === null) {
          continue;
        }
        const response = await this.fetchWithTimeout(url);
        if (response === null) {
          hadNetworkError = true;
          continue;
        }
        if (!response.ok) {
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
        return;
      } catch {
        hadNetworkError = true;
      }
    }

    // Offline or blocked by a proxy: try again next session instead of for a week.
    if (!hadNetworkError) {
      try {
        fs.writeFileSync(notFoundPath, "", "utf8");
      } catch {
        // ignore
      }
    }
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

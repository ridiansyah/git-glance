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
    return cleanEmail || author.toLowerCase().trim() || "unknown";
  }

  /**
   * Retrieves or generates a local avatar file path for the given author.
   */
  public getAvatarPath(
    author: string,
    email: string,
    isUncommitted: boolean,
    remoteCommitUrl?: string,
  ): string | null {
    if (isUncommitted) {
      return this.getYouAvatarPath();
    }

    const key = this.getAvatarKey(author, email, isUncommitted);
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    const hash = crypto.createHash("md5").update(key).digest("hex");
    const photoSvgPath = path.join(this.avatarDir, `${hash}_photo_v4.svg`);
    const initialsSvgPath = path.join(
      this.avatarDir,
      `${hash}_initials_v4.svg`,
    );

    // 1. If photo SVG was already downloaded and wrapped, use it!
    if (fs.existsSync(photoSvgPath)) {
      this.memoryCache.set(key, photoSvgPath);
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

    this.memoryCache.set(key, initialsSvgPath);

    // 3. Asynchronously attempt to fetch photo in background if not already fetching
    if (!this.fetchingSet.has(key)) {
      this.fetchingSet.add(key);
      this.fetchRemoteAvatar(author, email, photoSvgPath, key, remoteCommitUrl);
    }

    return initialsSvgPath;
  }

  /**
   * Generates a compact, friendly 14x14 avatar for uncommitted edits.
   */
  private getYouAvatarPath(): string | null {
    const youPath = path.join(this.avatarDir, "you_v4.svg");
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

    this.memoryCache.set("__you__", youPath);
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
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 14 14" width="14" height="14">
  <defs>
    <clipPath id="avatarClip">
      <circle cx="7" cy="7" r="7" />
    </clipPath>
  </defs>
  <image href="data:${mimeType};base64,${base64Data}" xlink:href="data:${mimeType};base64,${base64Data}" width="14" height="14" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />
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
   * Asynchronously attempts to fetch author photo from GitHub, Gravatar, or GitLab.
   */
  private async fetchRemoteAvatar(
    author: string,
    email: string,
    targetSvgPath: string,
    key: string,
    remoteCommitUrl?: string,
  ) {
    try {
      const urlsToTry: string[] = [];

      const cleanEmail = email.toLowerCase().trim();
      const cleanAuthor = author.trim();

      // 1. Check for GitHub noreply email (e.g. 12345+username@users.noreply.github.com)
      const ghNoreplyMatch = cleanEmail.match(
        /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i,
      );
      if (ghNoreplyMatch && ghNoreplyMatch[1]) {
        urlsToTry.push(
          `https://github.com/${encodeURIComponent(ghNoreplyMatch[1])}.png?size=64`,
        );
      }

      // 2. Gravatar check if email is available and not a noreply address
      if (cleanEmail && !cleanEmail.includes("noreply")) {
        const hash = crypto.createHash("md5").update(cleanEmail).digest("hex");
        urlsToTry.push(`https://www.gravatar.com/avatar/${hash}?s=64&d=404`);
      }

      // 3. GitHub username fallback (when author is a valid handle without spaces)
      const isValidHandle =
        /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(cleanAuthor);
      if (isValidHandle) {
        urlsToTry.push(
          `https://github.com/${encodeURIComponent(cleanAuthor)}.png?size=64`,
        );
      }

      // 4. GitLab username fallback if remote URL is gitlab.com
      if (
        remoteCommitUrl &&
        remoteCommitUrl.includes("gitlab.com") &&
        isValidHandle
      ) {
        urlsToTry.push(
          `https://gitlab.com/${encodeURIComponent(cleanAuthor)}.png`,
        );
      }

      for (const url of urlsToTry) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);

          const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
          });
          clearTimeout(timeout);

          if (response.ok) {
            const contentType =
              response.headers.get("content-type") || "image/png";
            if (contentType.startsWith("image/")) {
              const arrayBuffer = await response.arrayBuffer();
              const base64Data = Buffer.from(arrayBuffer).toString("base64");
              const wrappedSvg = this.wrapImageInSvg(base64Data, contentType);
              fs.writeFileSync(targetSvgPath, wrappedSvg, "utf8");
              this.memoryCache.set(key, targetSvgPath);
              this.notifyAvatarReady(key, targetSvgPath);
              return;
            }
          }
        } catch {
          // Continue to next candidate URL
        }
      }
    } catch {
      // Fail gracefully without crashing
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

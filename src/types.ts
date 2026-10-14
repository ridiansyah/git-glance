export interface BlameInfo {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  authorDate: Date;
  authorTimeZone: string;
  committer: string;
  committerEmail: string;
  committerDate: Date;
  summary: string;
  line: number; // 0-based
  isUncommitted: boolean;
  isCurrentUser?: boolean;
  repoRoot?: string;
  remoteCommitUrl?: string;
}

export interface BlameRequest {
  filePath: string;
  line: number; // 0-based
  documentVersion: number;
  lineCount: number;
  isDirty: boolean;
  /** Read lazily so cache hits never copy the document text. */
  getText: () => string;
}

/** Minimal log sink so `GitService` can report to an Output channel without importing vscode. */
export interface GitLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GitServiceOptions {
  /** Remote used for commit links. Empty string = `origin`, else the first remote. */
  remoteName: string;
  /** Pass `.git-blame-ignore-revs` from the repository root when it exists. */
  useIgnoreRevsFile: boolean;
  /** Optional custom URL template to override auto-detected web commit URLs. Empty string = auto-detect. */
  commitUrlTemplate: string;
}

export type DateStyle = "relative" | "absolute" | "short";

export type AvatarSource = "remote" | "initials";

export type GlancePreset =
  | "default"
  | "minimalist"
  | "playful"
  | "terminal"
  | "github"
  | "breadcrumb"
  | "bento"
  | "comment"
  | "custom";

export interface GitGlanceConfig {
  enabled: boolean;
  preset: GlancePreset;
  showAvatar: boolean;
  avatarSource: AvatarSource;
  prefix: string;
  format: string;
  uncommittedFormat: string;
  dateStyle: DateStyle;
  hoverDateFormat: string;
  delay: number;
  showHover: boolean;
  maxMessageLength: number;
  remote: string;
  useIgnoreRevsFile: boolean;
  commitUrlTemplate: string;
}

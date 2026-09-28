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
  body?: string;
  line: number; // 0-based
  isUncommitted: boolean;
  repoRoot?: string;
  remoteCommitUrl?: string;
  avatarPath?: string;
}

export type DateStyle = "relative" | "absolute" | "short";

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
  prefix: string;
  format: string;
  uncommittedFormat: string;
  dateStyle: DateStyle;
  delay: number;
  showHover: boolean;
}

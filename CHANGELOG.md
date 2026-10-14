# Changelog

All notable changes to the **Git Glance** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-10-14

### Added

- **`Git Glance: Show Log`**: an output channel with the git path in use and any git error (each message once). A Troubleshooting section in the README explains it.
- **CI on Windows and macOS** next to Linux.
- **Universal Git Remote Provider Detection**: Automatic zero-configuration commit URL generation for Bitbucket Cloud, Bitbucket Server / Data Center, Azure DevOps (`dev.azure.com`, `*.visualstudio.com`), AWS CodeCommit, Codeberg, SourceHut (`git.sr.ht`), Gitea, Forgejo, and Gitee.
- **Custom Commit URL Template** (`gitGlance.commitUrlTemplate`): Escape-hatch setting allowing custom or proprietary internal Git servers to define custom web commit URLs using tokens (`${host}`, `${path}`, `${sha}`, `${shortSha}`, `${project}`, `${repo}`).

### Changed

- **Inclusive Remote Command**: Renamed Command Palette title from `Git Glance: Open Commit on Remote (GitHub/GitLab)` to `Git Glance: Open Commit on Remote` and updated hover tooltips to be provider-agnostic.

- **Smaller, steadier blame cache**: a whole-file blame is now one cache entry per file version (16 kept), and single-line blames of large files keep the last 300. Before, three 2,000-line tabs evicted each other's lines and every tab switch started a new `git blame`.
- **Avatars**: photos are requested at 28 px (enough for a 14 px badge at 2x) and the SVG wrapper embeds the image once instead of twice. Existing avatar cache files are rebuilt once (`_v5`).
- The remote URL is parsed once per blame, and lines from the same commit share one link string.

### Fixed

- **Windows: no annotations**: Git Glance now runs the git executable VS Code found (`git.path`, registry, install folders) instead of assuming `git` is on `PATH`. A missing git shows one warning with a shortcut to the `git.path` setting. A failed lookup is no longer remembered as "not a repository".
- **Windows paths**: repository roots and file paths are compared after normalizing slashes, drive-letter case and trailing separators. Before, commits made outside the editor never refreshed the cache on Windows. Blame runs from the file's own folder, so drive or network-path differences can't break it.
- **Non-English git**: git runs with `LC_ALL=C`, so fallbacks that read git's error text work on any system language.
- **Broken hover links**: spaces and parentheses in repository paths (for example an Azure DevOps project named `My Project`) are percent-encoded, so "Open in Browser" no longer breaks the hover markdown.
- **Azure DevOps Server / TFS** on custom hosts is detected from the `/_git/` path segment.
- **Bitbucket Cloud Commit Links**: Fixed "Open in Browser" for Bitbucket Cloud SSH via port 443 (`altssh.bitbucket.org`), remotes ending in `.git/` with a trailing slash, and scp-style SSH remotes using non-`git` usernames.
- **Bitbucket Server / Data Center 404s**: Fixed on-premise Bitbucket URLs resolving to invalid 404 commit links; now properly maps `/scm/<project>/<repo>` and personal `~user` repositories to `/projects/<project>/repos/<repo>/commits/<sha>`.

## [1.2.0] - 2026-10-12

### Added

- **`gitGlance.maxMessageLength`** (default `60`): long commit messages are shortened with `…` instead of running off the right edge. Set to `0` for no limit.
- **`gitGlance.avatarSource`**: set to `"initials"` to use only local initials badges and make no network requests.
- **`.git-blame-ignore-revs` support** (`gitGlance.useIgnoreRevsFile`, on by default): commits listed in the file at the repository root, such as bulk formatting commits, are skipped. A malformed file is ignored instead of breaking blame.
- **`gitGlance.remote`**: choose the remote used for "Open in Browser". When empty, Git Glance uses `origin`, or the first remote if there is no `origin`.

### Changed

- **Cache survives window focus and saves**: Git Glance now clears a repository's blame cache only when its HEAD commit changes (commit, amend, checkout, reset). Before, every Git status refresh cleared all caches.
- **Unsaved files are blamed once per edit**: files up to 2,500 lines are blamed whole even with unsaved changes, so moving between lines no longer starts a Git process per line.
- **No Git process while typing**: the line you're editing shows `You, just now: Uncommitted changes` immediately.
- **Commit Details**: the commit body is shown on one line in the Quick Pick (Quick Pick can't show line breaks), and "Copy Commit Message" copies the full message.
- `gitGlance.delay` is limited to 0–2000 ms.

### Fixed

- **Wrong avatars**: author names are no longer guessed as GitHub or GitLab usernames, which showed an unrelated account's photo for names like "John" or "admin". Photos now come only from the GitHub noreply email, the GitHub commit API (github.com remotes), or Gravatar.
- **Missing annotations in repos with long history**: if blaming a whole file takes longer than 5 seconds, Git Glance falls back to single-line blame instead of showing nothing until the file is saved.
- **Annotations disappearing in unsaved files**: placing the cursor on the empty last line of a large unsaved file no longer hides blame for every other line.
- **Hover content**: HTML in commit messages and author names is shown as text. Before, a message containing `<img src=...>` could load a remote image whenever the hover opened.
- **Stale blame after a commit**: a blame that finishes after the cache was cleared is no longer stored.
- **Open Commit on Remote** works from a hover link even when the current line has no blame yet.
- **Fewer repeated avatar lookups**: authors without a photo are not looked up again for 7 days. Offline or proxy failures are retried next session.

## [1.1.4] - 2026-10-08

### Added

- **Self-Hosted GitLab Links**: "Open in Browser" now uses the correct `/-/commit/` path for self-hosted GitLab instances, not just `gitlab.com`.
- **Full Commit Body in Details**: `Git Glance: Show Commit Details` now shows the full multi-line commit message in the QuickPick, and accurately resolves arbitrary commit SHAs clicked from hover tooltips.
- **SHA-256 Git Repository Support**: Full compatibility with repositories initialized with `objectFormat=sha256` (64-character commit hashes).
- **External Git Commit Reactivity**: Detects commits made externally via terminal or Git SCM views through `vscode.git` API and window focus events, clearing caches automatically.

### Changed

- **Battery-Friendly Typing**: Edits on the active line now wait at least 300 ms before re-blaming and cancel any in-flight Git process right away.
- **Context-Aware Command Palette**: Copy Hash, Show Commit Details, and Open on Remote only appear when a file editor has focus.
- **Consistent Short Dates**: `${date}` always renders in English (e.g. `Sep 28, 2026`), whatever the system locale.
- **Scoped Configuration Toggle**: `toggle` and `toggleAvatar` now accurately respect and update workspace-level settings when configured in `.vscode/settings.json`.

### Fixed

- **Memory**: Clean documents no longer copy their full text on every cursor move.
- **Cross-Platform Cache Indexing**: File-scoped cache eviction now supports Windows drive paths (`C:\...`) seamlessly.
- **In-Flight Blame Deduplication & Negative Cache**: Prevents duplicate concurrent Git processes for the same file version and stops repeating failed blames on untracked/ignored files.
- **Sensitive Token Stripping**: Automatically removes embedded credentials and tokens from Git remote URLs before building web commit links.
- **Workspace Security Hardening**: Properly disables execution in untrusted workspaces / Restricted Mode to prevent unauthorized code execution.
- **Hover Command Sandboxing**: Restricts `MarkdownString.isTrusted` strictly to Git Glance's internal commands (`copyHash`, `showCommitDetails`).
- **Date Edge Cases**: Corrected relative time calculation for commits between 360 and 364 days old (preventing "0 years ago").
- **True LRU Cache**: Cache hits now refresh entry order, so lines you revisit aren't evicted first.
- **Faster Cache Invalidation**: Clearing a file's cache on save, edit, or close no longer scans the entire cache.
- **Stale Blame Race**: Typing on the active line cancels pending blame requests, so outdated results can't overwrite fresh ones.
- **Toggle Reliability**: `toggle` and `toggleAvatar` wait for the setting to be written before updating the view.
- **Avatar Timer Leak**: Avatar download timeouts are always cleared, even when a request fails.

---

## [1.1.3] - 2026-10-07

### Added

- **Hybrid Whole-File Blame & In-Memory Caching**: Clean saved documents ($\le 2500$ lines) are blamed once and parsed into an in-memory map in a single pass (~7ms), resolving all subsequent line navigations in **0ms (instant memory lookup)** with zero spawned Git processes.
- **Zero-Debounce on Cache Hit**: Cursor movements on cached lines render inline blame instantly without waiting for the 100ms debounce timer.
- **In-Flight Process Cancellation (`AbortController`)**: Rapid cursor navigation automatically terminates obsolete pending `git blame` subprocesses (`SIGTERM`), preventing background process queuing and saving CPU/battery.
- **Document Close Cache Eviction**: File blame caches are automatically purged when closing editor tabs (`onDidCloseTextDocument`), ensuring a lean memory footprint.

### Changed

- **Persistent Decoration Type Architecture**: Refactored `DecorationManager` to reuse persistent `TextEditorDecorationType` instances and apply dynamic content (`contentText`, `contentIconPath`, and `margin`) via `renderOptions.after`. Eliminates Monaco stylesheet churn and extension host IPC overhead.

---

## [1.1.2] - 2026-09-28

### Added

- **Current Git User Detection ("You" Display)**: Automatically detects when a commit was authored by the current Git user strictly by email (`git config user.email`), preventing name collisions across different contributors. Displays `You` inline (e.g. `(avatar) You, 3 days ago: Add JWT middleware`) while preserving the user's authentic avatar badge and full author details in hover cards.

### Changed

- **Cleaner Hover Card Header**: Simplified the commit hover card title to clean `### Git Glance` for a sleeker visual presentation.
- **Security Policy**: Broadened supported extension version range to `1.x.x` in `SECURITY.md`.

---

## [1.1.1] - 2026-09-28

### Changed

- **Refined Inline View**:
  - Committed lines default to: `(avatar) ${author}, ${time}: ${message}` (e.g. `(avatar) Wahyu Ridiansyah, 3 days ago: Add JWT middleware`).
  - Uncommitted lines default to: `${author}, ${time}: ${message}` (e.g. `You, 3 hours ago: Uncommitted changes`).
- **Dynamic Uncommitted Timestamps**: Uncommitted lines now calculate real relative time from the file's modification timestamp (e.g., `3 hours ago`, `just now`) instead of static text.
- **Distraction-Free Uncommitted Lines**: Avatar badges and hover card tooltips are disabled on uncommitted lines to keep cursor movement and typing completely clean.

---

## [1.1.0] - 2026-09-28

### Added

- **Configurable Hover Date Format**: Added `gitGlance.hoverDateFormat` setting to customize the exact timestamp displayed in the hover card tooltip.
- **Rich Token Support**: Added flexible date pattern tokens for `formatCustomDate`: `DD`, `D`, `MM`, `M`, `YYYY`, `YY`, `HH`, `H`, `hh`, `h`, `mm`, `m`, `ss`, `s`, `A`, `a`, `MMM`, `MMMM`, `ddd`, `dddd`, and `[escaped brackets]`.

### Changed

- Updated default hover date format from `YYYY-MM-DD HH:mm` to `DD/MM/YYYY HH:mm` (e.g., `25/09/2026 14:10`).

---

## [1.0.0] - 2026-09-28

### Initial Production Release 🎉

Welcome to the initial release of **Git Glance** — a modern, ultra-lightweight, and delightful inline Git blame extension for Visual Studio Code.

#### Added

- **Inline Git Blame**: Instant, theme-adaptive inline annotations displayed directly at the end of the active cursor line.
- **Avatar Badges**:
  - Automatically generated SVG initials badges with deterministic author color hashing.
  - Asynchronous background Gravatar fetching and caching for author photos.
  - Distinctive avatar for uncommitted working tree edits.
- **8 Built-in Presets**:
  - `default`: `(avatar) Author committed 3 days ago: Message`
  - `minimalist`: `· Author, 3d ago — Message`
  - `playful`: `👀 Author, 3 days ago • 🚀 Message`
  - `terminal`: `// git:author @ hash (3d) "Message"`
  - `github`: `@author committed 3d ago: Message`
  - `breadcrumb`: `› Author › 3d ago › Message`
  - `bento`: `⚡ Author │ ⏱️ 3d ago │ 💬 Message`
  - `comment`: `/* by Author, 3d ago: Message */`
- **Custom Template Engine (`preset: "custom"`)**: Full freedom to compose custom formats using tokens: `${author}`, `${email}`, `${authorEmail}`, `${time}`, `${date}`, `${isoDate}`, `${message}`, `${hash}`, `${shortHash}`, `${fullHash}`, and `${prefix}`.
- **Uncommitted Changes Detection**: Shows real-time working copy status (`You: uncommitted changes`) powered by `git blame --contents -` without requiring files to be saved.
- **Rich Interactive Hover Card**:
  - Displays author, email, relative time, exact timestamp, commit SHA, and commit message.
  - Direct action links: Copy SHA, View Commit Details, and Open in Remote Web Browser (GitHub, GitLab, Bitbucket).
- **Command Palette Integration**:
  - `Git Glance: Toggle Inline Blame`
  - `Git Glance: Toggle Avatar`
  - `Git Glance: Copy Commit Hash`
  - `Git Glance: Show Commit Details` (interactive QuickPick with message copying)
  - `Git Glance: Open Commit on Remote (GitHub/GitLab)`
- **Avatar Enhancements**:
  - Constrained all avatar badges and photos to strict **14px × 14px** SVG dimensions to prevent editor line height distortions and overlapping text.
  - Multi-source avatar resolution: GitHub noreply emails (`...@users.noreply.github.com`), Gravatar, GitHub username handles (`https://github.com/{author}.png`), and GitLab handles.
  - Reactive live updates via `onAvatarReady` without requiring cursor movements once background photo fetch completes.
- **Performance & Polish**:
  - Zero runtime dependencies.
  - Bundled with `esbuild` for instant startup and negligible memory footprint.
  - Debounced cursor tracking (configurable via `gitGlance.delay`).
  - In-memory blame caching with automatic invalidation on document save and change.

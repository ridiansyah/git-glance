# Changelog

All notable changes to the **Git Glance** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

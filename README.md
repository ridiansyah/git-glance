<h1 align="center">Git Glance</h1>

<p align="center">
  <strong>Super lightweight, clean, and fun inline Git blame for Visual Studio Code.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=ridiansyah.git-glance"><img src="https://badgen.net/vs-marketplace/v/ridiansyah.git-glance" alt="VS Code Marketplace"></a>
  <a href="https://github.com/ridiansyah/git-glance/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/vscode-%5E1.85.0-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/bundle%20size-%7E25%20KB-brightgreen.svg" alt="Bundle Size">
  <img src="https://img.shields.io/badge/package%20size-%3C%2032%20KB-brightgreen.svg" alt="Package Size">
  <a href="https://github.com/ridiansyah/git-glance/blob/main/CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
</p>

---

## 💡 Why Git Glance?

Full-fledged Git extensions are feature-packed, but they can often feel heavy, clutter your editor, or slow down file navigation.

**Git Glance** was crafted for developers who only want the essential information directly in their flow:

- **Who** wrote this line of code?
- **What** was the commit message?
- **When** was it committed?

No bloat, no complex menus, and zero background clutter. Just a clean, modern, and fun glance at your code's history.

### 🏎️ Comparison: Git Glance vs. Heavy Git Suites

| Feature / Metric           | ⚡ Git Glance                                                                                            | Heavy Git Extensions (e.g. GitLens)        |
| :------------------------- | :------------------------------------------------------------------------------------------------------ | :----------------------------------------- |
| **Package Size (VSIX)**    | **~31 KB**                                                                                              | **~25 - 40 MB** (~1000× larger)            |
| **Minified Bundle**        | **~25 KB**                                                                                              | **~5 - 10 MB**                             |
| **Runtime Dependencies**   | **0** (Zero external dependencies)                                                                      | Dozens of npm packages                     |
| **Startup Impact**         | **0 ms** (`onStartupFinished`)                                                                          | Often adds noticeable startup delay        |
| **Blame Execution**        | **Hybrid blame** (0ms instant in-memory cache for clean files + targeted 1-line for dirty/large files)    | Full-file / repository indexing            |
| **Memory Footprint (RAM)** | **< 15 MB** (bounded LRU cache)                                                                         | Up to 100+ MB                              |
| **Telemetry & Accounts**   | **100% Private, zero accounts/sign-in**                                                                 | Requires accounts, cloud sync, telemetry   |
| **Focus & Feel**           | **Distraction-free inline annotations**                                                                 | Heavy sidebars, revision trees, git graphs |

---

## ✨ Features

- **⚡ Blazing Fast & Ultra-Lightweight**: Bundled with `esbuild` into a single ~25 KB file with zero runtime dependencies.
- **⚡ Instant 0ms Lookups & Zero-Debounce**: Clean saved files are blamed once and cached in memory, resolving cursor movements in 0ms with zero spawned Git subprocesses.
- **🛡️ Process Cancellation & Zero DOM Churn**: Automatically aborts obsolete in-flight Git processes on fast cursor navigation and reuses persistent decoration types to eliminate Monaco stylesheet churn.
- **🔋 Battery-Friendly Typing**: While you type on the active line, re-blame waits for a longer pause (≥ 300 ms) and cancels stale Git processes, so subprocesses don't pile up.
- **👀 Subdued Inline Annotation**: Appears gracefully at the end of the active cursor line with subtle, theme-adaptive coloring.
- **✨ Uncommitted Line Detection**: Detects uncommitted and newly added lines seamlessly (`You, 3 hours ago: Uncommitted changes`).
- **💬 Rich Interactive Hover Card**: Hovering over the annotation displays an elegant card with:
  - Author name, email, and exact commit timestamp.
  - Short commit SHA.
  - Formatted commit subject and multi-line body.
  - Quick action buttons: **Copy Hash**, **View Details**, and **Open on Web** (GitHub / GitLab incl. self-hosted / Bitbucket).
- **🎨 Theme-Adaptive**: Automatically blends with your favorite VS Code light and dark color themes.
- **🛠️ Fully Configurable**: Personalize prefix emojis, text templates, date formats, and debounce speed.

---

## 📸 Visual Preview

### Default Inline Style (with Profile Picture / Avatar):

```typescript
const authService = new AuthService();  (avatar) You, 3 days ago: Add JWT middleware
const dbService = new DbService();      (avatar) Linus Torvalds, 3 days ago: Add connection pool
const session = authService.init();    You, 3 hours ago: Uncommitted changes
```

> **Smart Author Recognition**: Git Glance automatically detects if you authored the commit using your configured Git email (`git config user.email`) and displays `You` instead of your name, while keeping your avatar badge intact!

### Available Visual Presets (`gitGlance.preset`):

| Preset       | Preview (Your Commits)                           | Preview (Other Authors)                                       |
| :----------- | :----------------------------------------------- | :------------------------------------------------------------ |
| `default`    | `(avatar) You, 3 days ago: Add JWT middleware`   | `(avatar) Wahyu Ridiansyah, 3 days ago: Add JWT middleware`   |
| `minimalist` | `· You, 3d ago — Add JWT middleware`             | `· Wahyu Ridiansyah, 3d ago — Add JWT middleware`             |
| `playful`    | `👀 You, 3 days ago • 🚀 Add JWT middleware`     | `👀 Wahyu Ridiansyah, 3 days ago • 🚀 Add JWT middleware`     |
| `terminal`   | `// git:You @ 7a8f3b2 (3d) "Add JWT middleware"` | `// git:Wahyu Ridiansyah @ 7a8f3b2 (3d) "Add JWT middleware"` |
| `github`     | `@You, 3d ago: Add JWT middleware`               | `@Wahyu Ridiansyah, 3d ago: Add JWT middleware`               |
| `breadcrumb` | `› You › 3d ago › Add JWT middleware`            | `› Wahyu Ridiansyah › 3d ago › Add JWT middleware`            |
| `bento`      | `⚡ You │ ⏱️ 3d ago │ 💬 Add JWT middleware`     | `⚡ Wahyu Ridiansyah │ ⏱️ 3d ago │ 💬 Add JWT middleware`     |
| `comment`    | `/* by You, 3d ago: Add JWT middleware */`       | `/* by Wahyu Ridiansyah, 3d ago: Add JWT middleware */`       |
| `custom`     | Personalized via `gitGlance.format`              | Personalized via `gitGlance.format`                           |

### Interactive Hover Card:

```markdown
### Git Glance

👤 Author: Wahyu Ridiansyah <wahyu@example.com>
📅 Date: 3 days ago (25/09/2026 14:10)
🔖 Commit: 7a8f3b2

> Add JWT middleware

---

[📋 Copy Hash] • [🔍 Details] • [🌐 Open in Browser]
```

---

## ⌨️ Available Commands

Access these commands anytime from the VS Code Command Palette (`Cmd + Shift + P` on macOS, `Ctrl + Shift + P` on Windows/Linux):

| Command                                             | Description                                                             |
| :-------------------------------------------------- | :---------------------------------------------------------------------- |
| `Git Glance: Toggle Inline Blame`                   | Quickly toggle inline annotations on or off.                            |
| `Git Glance: Toggle Avatar`                         | Quickly toggle avatar profile pictures / initials badges on or off.     |
| `Git Glance: Copy Commit Hash`                      | Copies the commit SHA of the current line to the clipboard.             |
| `Git Glance: Show Commit Details`                   | Opens an interactive QuickPick showing full commit details and actions. |
| `Git Glance: Open Commit on Remote (GitHub/GitLab)` | Opens the current commit page in your default browser.                  |

---

## ⚙️ Configuration & Customization

Open VS Code **Settings** (`Cmd + ,` or `Ctrl + ,`) and search for `Git Glance`:

| Setting                       | Default                            | Description                                                                                                                                                                |
| :---------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitGlance.enabled`           | `true`                             | Enable or disable inline annotations globally.                                                                                                                             |
| `gitGlance.preset`            | `"default"`                        | Choose a preset style (`default`, `minimalist`, `playful`, `terminal`, `github`, `breadcrumb`, `bento`, `comment`), or select `"custom"` to design your own format freely. |
| `gitGlance.showAvatar`        | `true`                             | Display profile picture / avatar next to inline annotation.                                                                                                                |
| `gitGlance.format`            | `"${author}, ${time}: ${message}"` | Custom template for inline annotation (used when preset is `"custom"`).                                                                                                    |
| `gitGlance.uncommittedFormat` | `"${author}, ${time}: ${message}"` | Custom template for uncommitted lines (used when preset is `"custom"`).                                                                                                    |
| `gitGlance.dateStyle`         | `"relative"`                       | Style for dates: `"relative"` (e.g. `3 days ago`), `"short"`, or `"absolute"`.                                                                                             |
| `gitGlance.hoverDateFormat`   | `"DD/MM/YYYY HH:mm"`               | Format for the exact commit timestamp shown in hover card tooltip.                                                                                                         |
| `gitGlance.delay`             | `100`                              | Debounce delay in milliseconds before fetching git blame on cursor movement.                                                                                               |
| `gitGlance.showHover`         | `true`                             | Show interactive hover card when moving cursor over the annotation.                                                                                                        |
| `gitGlance.prefix`            | `"👀 "`                            | Prefix emoji or text token (available as `${prefix}` in custom format).                                                                                                    |

### Custom Format Tokens (`gitGlance.format`):

When `gitGlance.preset` is set to `"custom"`, you can freely compose your own line format with these tokens:

| Token                      | Description                       | Example               |
| :------------------------- | :-------------------------------- | :-------------------- |
| `${author}`                | Commit author name                | `Wahyu Ridiansyah`    |
| `${email}`                 | Commit author email with brackets | `<wahyu@example.com>` |
| `${authorEmail}`           | Raw author email                  | `wahyu@example.com`   |
| `${time}`                  | Relative or styled commit date    | `3 days ago`          |
| `${date}`                  | Formatted short date              | `Sep 25, 2026`        |
| `${isoDate}`               | Full date & timestamp             | `2026-09-25 14:10`    |
| `${message}`               | Commit subject message            | `Add JWT middleware`  |
| `${hash}` / `${shortHash}` | Short commit SHA (7 characters)   | `7a8f3b2`             |
| `${fullHash}`              | Full 40-character commit SHA      | `7a8f3b2...`          |
| `${prefix}`                | Custom prefix string/emoji        | `👀 `                 |

For uncommitted lines (`gitGlance.uncommittedFormat`), `${author}`, `${message}`, `${prefix}`, and `${time}` are supported.

### Hover Date Format Tokens (`gitGlance.hoverDateFormat`):

Customize the exact timestamp displayed in the hover card tooltip using these tokens:

| Token          | Description                        | Example                   |
| :------------- | :--------------------------------- | :------------------------ |
| `DD` / `D`     | Day of month (2-digit / 1-digit)   | `25`, `5`                 |
| `MM` / `M`     | Month number (2-digit / 1-digit)   | `09`, `9`                 |
| `YYYY` / `YY`  | Year (4-digit / 2-digit)           | `2026`, `26`              |
| `HH` / `H`     | 24-hour format (2-digit / 1-digit) | `14`, `9`                 |
| `hh` / `h`     | 12-hour format (2-digit / 1-digit) | `02`, `2`                 |
| `mm` / `m`     | Minutes (2-digit / 1-digit)        | `10`, `5`                 |
| `ss` / `s`     | Seconds (2-digit / 1-digit)        | `05`, `5`                 |
| `A` / `a`      | AM/PM or am/pm                     | `PM`, `pm`                |
| `MMM` / `MMMM` | Month name (short / full)          | `Sep`, `September`        |
| `ddd` / `dddd` | Weekday name (short / full)        | `Fri`, `Friday`           |
| `[...]`        | Escaped literal text               | `[at] HH:mm` → `at 14:10` |

---

## 🚀 Installation

### Option 1: Install from VS Code Marketplace (Recommended)

Install directly from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ridiansyah.git-glance) or from within VS Code:

1. Open the **Extensions** view in VS Code (`Cmd + Shift + X` on macOS, `Ctrl + Shift + X` on Windows/Linux).
2. Search for **`Git Glance`**.
3. Click **Install**.

_Or install directly via CLI:_

```bash
code --install-extension ridiansyah.git-glance
```

### Option 2: Install from VSIX (Local Release)

Download the latest `git-glance-x.x.x.vsix` from [GitHub Releases](https://github.com/ridiansyah/git-glance/releases) or build it locally, then:

```bash
code --install-extension git-glance-1.0.0.vsix
```

_Or via VS Code UI: Extensions view (`Cmd+Shift+X`) ➔ `...` menu at top right ➔ **Install from VSIX...** ➔ Select the `.vsix` file._

### Option 3: Build & Run from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/ridiansyah/git-glance.git
   cd git-glance
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Open in VS Code and press **`F5`** (or run `Launch Git Glance` in the Run & Debug view). A new Extension Development Host window will launch with Git Glance active!

---

## 🛠️ Development & Contributing

Contributions, bug reports, and feature requests are very welcome! Please read our [Contributing Guide](CONTRIBUTING.md) to get started.

### Development Scripts:

```bash
# Compile bundle with esbuild
pnpm run compile

# Watch mode for rapid local iteration
pnpm run watch

# Run TypeScript type check
pnpm run lint

# Run built-in unit tests
pnpm test

# Package into a release .vsix file
pnpm run package:vsix
```

### Community & Standards:

- [Contributing Guide](CONTRIBUTING.md) — How to propose changes and submit PRs.
- [Changelog](CHANGELOG.md) — Full release history.
- [Code of Conduct](CODE_OF_CONDUCT.md) — Our community guidelines.
- [Security Policy](SECURITY.md) — How to report security vulnerabilities.
- [Agent & Architectural Standards](AGENTS.md) — Technical guidelines and conventions.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). Made with ❤️ for a cleaner, faster coding experience.

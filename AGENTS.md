# Project Guidelines: Git Glance

## 0. Automated Documentation Maintenance (MANDATORY FOR ALL AI AGENTS)

> **CRITICAL RULE**: Whenever you introduce, modify, refactor, or establish any **new rules, architectural standards, code patterns, configuration keys, core utilities, or global conventions**:
>
> 1. You **MUST automatically and proactively update** [`AGENTS.md`](file:///Users/ridiansyah/Developer/git-glance/AGENTS.md) (and [`DESIGN.md`](file:///Users/ridiansyah/Developer/git-glance/DESIGN.md) if present) in the **very same turn/response**.
> 2. **DO NOT wait** for the user to prompt, ask, or remind you to update documentation.
> 3. **SCOPE & RELEVANCE FILTER (STRICT)**:
>    - **DO document**: Extension architecture, VS Code API patterns, Git blame execution & caching strategies, naming conventions (kebab-case), configuration properties, and engineering standards.
>    - **DO NOT document**: Temporary debug scripts, transient scratch notes, or non-architectural one-line edits.
> 4. Keep this document 100% accurate, high-signal, clean, and strictly focused on development standards.

---

## 1. Project Overview & Tech Stack

- **Project**: **Git Glance** (Super lightweight, clean, and fun inline Git blame for VS Code).
- **Core Purpose**: Shows who wrote code on the active line, commit message, and commit date directly inline with modern, fun, and lightweight UX.
- **Runtime & Target**: VS Code Extension API (`^1.85.0`), Node.js (v20+ / v22+).
- **Package Manager**: `pnpm` (run with `pnpm install`, `pnpm run compile`, `pnpm test`).
- **Language**: TypeScript (ES2022 target, strict mode enabled).
- **Bundler**: `esbuild` (Ultra-fast CJS bundling into `dist/extension.js`, externalizing `vscode`).
- **Packaging**: `@vscode/vsce` (Produces ultra-compact `git-glance-1.0.0.vsix` under ~20 KB bundle / ~50 KB with icon).
- **Testing**: Built-in `node:test` runner (`pnpm test`) compiling tests on the fly via `esbuild`.

---

## 2. Directory Structure & Architecture

All source files **MUST strictly adhere to kebab-case naming conventions**.

```text
git-glance/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md        # GitHub bug report issue template
│   │   └── feature_request.md   # GitHub feature request issue template
│   ├── pull_request_template.md # GitHub pull request template
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI matrix build, lint, test, & package
├── .vscode/
│   ├── launch.json          # F5 Extension Development Host debug configuration
│   └── tasks.json           # Background esbuild watch build task
├── dist/                    # Bundled extension outputs (git-ignored)
│   └── extension.js         # Final minified CJS bundle for VS Code runtime
├── images/
│   └── icon.png             # Official 256x256 extension marketplace icon
├── src/
│   ├── extension.ts         # Extension activation/deactivation entrypoint
│   ├── glance-controller.ts # Orchestrates editor events & cursor debouncing
│   ├── git.ts               # Git CLI executor, porcelain parser, cache, & remote URL resolver
│   ├── decoration.ts        # TextEditorDecorationType management & Markdown hover builder
│   ├── commands.ts          # VS Code command registrations (toggle, toggleAvatar, copyHash, details, remote)
│   ├── types.ts             # TypeScript interfaces (BlameInfo, GitGlanceConfig, GlancePreset, DateStyle)
│   ├── utils/
│   │   ├── avatar.ts        # 14x14 SVG initials generator & multi-source avatar resolver (GitHub, Gravatar, GitLab)
│   │   ├── date.ts          # Human-friendly relative time, short date, and ISO date formatters
│   │   └── format.ts        # Preset registry (default, minimalist, playful, etc.) & string interpolator
│   └── test/
│       └── unit.test.ts     # Fast unit tests for utilities and parsers
├── .gitignore
├── .vscodeignore            # Excludes src/, dev files, and tests from .vsix package
├── CHANGELOG.md             # Standard Keep a Changelog release history
├── CODE_OF_CONDUCT.md       # Contributor Covenant v2.1 code of conduct
├── CONTRIBUTING.md          # Open-source developer onboarding and contribution guide
├── LICENSE                  # MIT License
├── package.json             # Manifest, contributes (commands, config, colors), scripts, icon
├── README.md                # User-facing documentation & usage guide
├── SECURITY.md              # Security reporting guidelines
└── tsconfig.json            # TypeScript configuration
```

---

## 3. UI, Visual Guidelines & VS Code Integration

Git Glance runs inside the VS Code editor canvas. All UI must be clean, unintrusive, and theme-adaptive.

### 3.1 Inline Annotation Style & Presets

- **Dual-Decoration Architecture (`after:` only)**:
  - To prevent caret jumps or glitches when clicking code or pressing End, decorations **NEVER use `before:` on `line.range.end`**. Attaching `before:` on `Range(line.range.end, line.range.end)` causes Monaco to position `line.range.end` to the right of `before:`, causing the cursor to jump/shift past the avatar.
  - Instead, Git Glance uses two decoupled `TextEditorDecorationType`s (`avatarDecorationType` and `textDecorationType`), **BOTH using `after:`** with `rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed` on `Range(line.range.end, line.range.end)`.
  - Because both decorations use `after:`, `line.range.end` remains strictly before both decorations, keeping the cursor pinned cleanly at the end of the code without jumping or shifting across the avatar.
  - `avatarDecorationType`: `after: { contentIconPath: avatarUri, width: '14px', height: '14px', margin: '0 6px 0 3em', textDecoration: 'none; vertical-align: middle' }`.
  - `textDecorationType`: `after: { contentText: inlineText, margin: hasAvatar ? '0' : '0 0 0 3em', color: new vscode.ThemeColor('gitGlance.inlineColor'), textDecoration: 'none; vertical-align: middle' }`.
  - **Single `hoverMessage` Attachment Rule**: `hoverMessage` is attached strictly to `textDecorationType`. It MUST NOT be attached to `avatarDecorationType`. In Monaco, when multiple decoration types on the same line range specify `hoverMessage`, VS Code stacks all hover cards together, causing a duplicated/double hover popup.
- **Avatar Vertical Alignment (CSS Injection via `textDecoration`)**:
  - In VS Code's Extension Host, decoration options sent across RPC are strictly whitelisted by `fmt.from(e)` (`margin`, `width`, `height`, etc.), **dropping properties like `verticalAlign`**.
  - However, Monaco's CSS renderer on the renderer side DOES support `verticalAlign` via the template `"vertical-align:{0};"` and the `collectCSSText` function reads it from the resolved decoration object.
  - The `textDecoration` property survives the RPC bridge and is rendered via template `"text-decoration:{0};"` with simple `{0}` substitution and **no value sanitization**.
  - By setting `textDecoration: "none; vertical-align: middle"`, the CSS renderer produces `text-decoration: none; vertical-align: middle;` — effectively injecting `vertical-align` through the RPC bridge.
  - Both `avatarDecorationType` and `textDecorationType` use this technique so avatar and text align to the same vertical center.
  - **NEVER use `margin-bottom` negative values** for vertical alignment — they don't reliably center and cause line-height distortion.
  - To prevent line-height distortion, all avatar SVGs **MUST use native dimensions of exactly 14px × 14px** (`viewBox="0 0 14 14" width="14" height="14"`) with circle centered at `(7, 7)` and radius `7`.
  - Cache files use `_v4.svg` suffix to guarantee cache invalidation.
- **Avatar Resolution Strategy**:
  1. Local initials SVG (14x14) generated synchronously for instant display.
  2. Background remote fetch waterfall: GitHub noreply email username -> Gravatar MD5 -> GitHub username handle -> GitLab handle.
  3. Live reactive update: Once remote photo is downloaded and converted to 14x14 SVG, `AvatarService` notifies `GlanceController` via `onAvatarReady` to re-render the active editor line without requiring cursor movements.
- **Avatar Configuration & Toggle**:
  - `gitGlance.showAvatar` (boolean, default: `true`): Master switch to toggle avatar visibility.
  - `gitGlance.toggleAvatar` command: Quickly toggle avatar visibility on/off via Command Palette.
- **Colors**: Never hardcode hex colors in code. Always use `new vscode.ThemeColor('gitGlance.inlineColor')`, which falls back to theme-adaptive defaults defined in `package.json` (`#88888888` on dark, `#66666688` on light).
- **Default Visual Style (User Default)**:
  - Committed lines: `(avatar) ${author}, ${time}: ${message}`
  - Uncommitted / modified lines: `${author}, ${time}: ${message}` (e.g. `You, 3 hours ago: Uncommitted changes`) (strictly no avatar badge, no hover tooltip popup)
- **Supported Presets (`gitGlance.preset`)**:
  1. `default`: `(avatar) Wahyu Ridiansyah, 3 days ago: Add JWT middleware`
  2. `minimalist`: `· Wahyu Ridiansyah, 3d ago — Add JWT middleware`
  3. `playful`: `👀 Wahyu Ridiansyah, 3 days ago • 🚀 Add JWT middleware`
  4. `terminal`: `// git:Wahyu Ridiansyah @ 7a8f3b2 (3d) "Add JWT middleware"`
  5. `github`: `@Wahyu Ridiansyah, 3d ago: Add JWT middleware`
  6. `breadcrumb`: `› Wahyu Ridiansyah › 3d ago › Add JWT middleware`
  7. `bento`: `⚡ Wahyu Ridiansyah │ ⏱️ 3d ago │ 💬 Add JWT middleware`
  8. `comment`: `/* by Wahyu Ridiansyah, 3d ago: Add JWT middleware */`
  9. `custom`: Uses custom `gitGlance.format` and `gitGlance.uncommittedFormat`.

### 3.2 Rich Interactive Hover Card

- Built with `vscode.MarkdownString` with `supportThemeIcons = true`, `isTrusted = true`, and `supportHtml = true`.
- **Uncommitted Lines Policy**: Returns `undefined` so that no hover popup appears on uncommitted lines, keeping the editor distraction-free while typing.
- Uses native VS Code Codicons (`$(...)`) instead of emoticons or external SVGs:
  - Zero disk I/O, zero network, zero decoding latency (instant 0 ms render).
  - 100% theme-adaptive (automatically adjusts to dark, light, and high-contrast themes).
  - Native anchor styling in action links without layout or underline breaks.
- Layout:
  1. Header with icon and title (`### $(eye) Git Glance` or `### $(sparkle) Git Glance`).
  2. Author line: `$(account) **Author:** ...`.
  3. Date line: `$(calendar) **Date:** ${timeAgo} (${exactDate})` (formatted with `gitGlance.hoverDateFormat`, defaulting to `DD/MM/YYYY HH:mm`).
  4. Commit line: `$(git-commit) **Commit:** ...`.
  5. Blockquote containing commit message summary and body.
  6. Action links: `[$(copy) Copy Hash](command:gitGlance.copyHash?...)`, `[$(info) Details](command:gitGlance.showCommitDetails?...)`, and `[$(link-external) Open in Browser](url)`.

### 3.3 Custom Format Tokens (`gitGlance.format`)

When `gitGlance.preset` is set to `"custom"`, users can freely compose their inline line annotations using any combination of:

- `${author}`: Commit author name (e.g. `Wahyu Ridiansyah`)
- `${email}`: Author email enclosed in brackets (e.g. `<wahyu@example.com>`)
- `${authorEmail}`: Raw author email without brackets
- `${time}`: Relative or styled date according to `gitGlance.dateStyle` (e.g. `3 days ago`)
- `${date}`: Formatted short date (e.g. `Sep 25, 2026`)
- `${isoDate}`: Full ISO date (`2026-09-25 14:10`)
- `${message}`: Commit subject summary
- `${hash}` / `${shortHash}`: 7-character commit SHA
- `${fullHash}`: Full 40-character commit SHA
- `${prefix}`: Configured prefix text/emoji

For uncommitted lines (`gitGlance.uncommittedFormat`), tokens `${author}`, `${message}`, `${prefix}`, and `${time}` are supported.

### 3.4 Hover Date Format (`gitGlance.hoverDateFormat`)

- Default: `"DD/MM/YYYY HH:mm"` (e.g. `25/09/2026 14:10`).
- Configurable via `gitGlance.hoverDateFormat` setting.
- Evaluated by `formatCustomDate(date: Date, pattern: string)` in `src/utils/date.ts`.
- Supported single-pass tokens:
  - `YYYY` (4-digit year), `YY` (2-digit year)
  - `MMMM` (Full month name), `MMM` (Short month name), `MM` (2-digit month), `M` (1-digit month)
  - `DD` (2-digit day of month), `D` (1-digit day of month)
  - `dddd` (Full weekday name), `ddd` (Short weekday name)
  - `HH` (2-digit 24-hr), `H` (1-digit 24-hr)
  - `hh` (2-digit 12-hr), `h` (1-digit 12-hr)
  - `mm` (2-digit minute), `m` (1-digit minute)
  - `ss` (2-digit second), `s` (1-digit second)
  - `A` (`AM`/`PM`), `a` (`am`/`pm`)
  - `[...]` Escaped literal text (e.g. `[at] HH:mm` renders `at 14:10`)

---

## 4. Engineering Discipline & Implementation Rules

### 4.1 Naming Convention (STRICT KEBAB-CASE)

- **All file and folder names MUST use kebab-case** (e.g. `glance-controller.ts`, `date.ts`, `unit.test.ts`).
- Never introduce camelCase or PascalCase file names in this repository.

### 4.2 Git CLI & Blame Execution Rules

- **Blame Command**: Use `git blame -L <line>,<line> --porcelain -- <filePath>`.
  - Lines in VS Code are 0-indexed; `git blame` is 1-indexed (always add +1).
- **Interactive Hanging Prevention**: Always execute git subprocesses with `GIT_TERMINAL_PROMPT: "0"` in the process environment to prevent background git commands from hanging indefinitely on credential or passphrase prompts.
- **Unsaved / Dirty Document Handling**: When the document is dirty (`document.isDirty`), pass document contents through stdin using `--contents -`.
- **Real-Time Active Line Editing Reactivity**: Listen to `vscode.workspace.onDidChangeTextDocument` to immediately detect edits affecting the current active line, invalidating the current blame and scheduling a debounced re-blame so uncommitted status (`uncommitted changes`) displays in real time without waiting for cursor line jumps.
- **In-Memory Caching & Remote URL Resolution**:
  - Cache blame results keyed by `${filePath}:${documentVersion}:${line}`.
  - Invalidate file cache on document save (`onDidSaveTextDocument`) or document modification.
  - Await `getRemoteCommitUrl` resolution before returning blame info so `remoteCommitUrl` is immediately available on initial hover render and avatar lookups.
- **Debouncing**: Cursor line changes and active-line document changes must be debounced (default `100ms`) to avoid spawning redundant git processes when navigating or typing rapidly.
- **Race Condition & Boundary Prevention**:
  - After awaiting an async git operation, always verify that `vscode.window.activeTextEditor === editor` and `editor.selection.active.line === line` before setting decorations.
  - Always guard against out-of-bounds line numbers (`blame.line < 0 || blame.line >= editor.document.lineCount`) before accessing `editor.document.lineAt`.
- **Token Replacement Safety**: Use single-pass regular expression token replacements to prevent recursive or cascading substitutions if commit messages or author names contain format token strings (e.g. `${author}`, `${hash}`).

### 4.3 Git Commit Policy

- **DO NOT run git commits automatically** unless explicitly approved/requested by the user ("dont commit" policy).

### 4.4 Ban on Sloppy Chained Fallbacks (`||` / `??`)

- Do NOT chain loose fallbacks like `val = a || b || c || ""` solely to silence TypeScript.
- Perform explicit `null` / `undefined` checks or type guards.
- For missing git data or untracked files, fail gracefully by clearing decorations instead of displaying corrupted strings.

### 4.5 Build & Verification Workflow

Before declaring any task complete, always verify:

```bash
pnpm run compile       # esbuild bundling
pnpm run lint          # tsc --noEmit
pnpm test              # node:test unit tests
pnpm run package:vsix  # produce compact .vsix package
```

### 4.6 Open Source & VS Code Marketplace Standards

- **Release Documentation**: Every release MUST be logged in [`CHANGELOG.md`](file:///Users/ridiansyah/Developer/git-glance/CHANGELOG.md) adhering to Keep a Changelog.
- **Community Standards**: Maintain [`CONTRIBUTING.md`](file:///Users/ridiansyah/Developer/git-glance/CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](file:///Users/ridiansyah/Developer/git-glance/CODE_OF_CONDUCT.md), and [`SECURITY.md`](file:///Users/ridiansyah/Developer/git-glance/SECURITY.md) in English.
- **Marketplace Assets**: The extension icon is located at `images/icon.png` (256x256 PNG) and must be bundled into the package via `.vscodeignore` whitelist.
- **Package Size Verification**: The built `.vsix` file MUST stay ultra-compact (target under 25 KB). Keep non-runtime assets, tests, and source code ignored in `.vscodeignore`.

---

<!-- antislop:start -->

## antislop

For UI, copy, people, mobile layout, or code comments work, use the Antislop filter skills available in your agent environment:

- Core filter: `antislop`
- UI / visual: `antislop-ui`
- Copy & text: `antislop-copywriting`
- People / accessibility: `antislop-human`
- Mobile / responsive: `antislop-layoutmobile`
- Code comments: `antislop-code`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->

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
- **Bundler**: `esbuild` (CJS bundle into `dist/extension.js`, externalizing `vscode`, `--target=node18` to match the Node runtime of VS Code 1.85's Electron).
- **Packaging**: `@vscode/vsce` (~37 KB minified bundle / ~41 KB total `.vsix` with icon).
- **Testing**: Built-in `node:test` runner (`pnpm test`) compiling tests on the fly via `esbuild`. Pure-function tests live in `unit.test.ts`; `git-service.test.ts` runs `GitService` against real temporary git repositories.

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
│   ├── extension.ts         # Activation entrypoint & vscode.git HEAD watcher (external commits)
│   ├── glance-controller.ts # Orchestrates editor events & cursor debouncing
│   ├── git.ts               # Git CLI executor (typed errors), porcelain parser, cache, remote & ignore-revs resolver
│   ├── decoration.ts        # TextEditorDecorationType management & Markdown hover builder
│   ├── commands.ts          # VS Code command registrations (toggle, toggleAvatar, copyHash, details, remote)
│   ├── types.ts             # TypeScript interfaces (BlameInfo, BlameRequest, GitServiceOptions, GitGlanceConfig, ...)
│   ├── utils/
│   │   ├── avatar.ts        # 14x14 SVG initials generator & email-verified avatar resolver (GitHub, Gravatar)
│   │   ├── date.ts          # Human-friendly relative time, short date, and ISO date formatters
│   │   ├── format.ts        # Preset registry, string interpolator, truncation & markdown escaping
│   │   ├── paths.ts         # Pure cross-platform path normalizer (Windows drive/slash/case) & isInsideDir
│   │   └── remote.ts        # Pure Git remote URL parser, SSH normalizer, & multi-provider commit URL builder
│   └── test/
│       ├── unit.test.ts         # Fast unit tests for utilities and parsers
│       └── git-service.test.ts  # GitService integration tests against temporary git repos
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

- **Dual-Decoration Architecture (`after:` only & Reusable Types)**:
  - To prevent caret jumps or glitches when clicking code or pressing End, decorations **NEVER use `before:` on `line.range.end`**. Attaching `before:` on `Range(line.range.end, line.range.end)` causes Monaco to position `line.range.end` to the right of `before:`, causing the cursor to jump/shift past the avatar.
  - Instead, Git Glance uses two persistent, reusable `TextEditorDecorationType`s (`avatarDecorationType` and `textDecorationType`), **BOTH using `after:`** with `rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed` on `Range(line.range.end, line.range.end)`.
  - **No Decoration Type Churn**: `avatarDecorationType` and `textDecorationType` are created **once** upon initialization and never disposed/recreated per cursor movement. Dynamic properties (`contentText`, `contentIconPath`, and `margin`) are passed dynamically per-line via `editor.setDecorations(type, [{ range, hoverMessage, renderOptions: { after: ... } }])`. This completely eliminates Monaco style sheet rule regeneration and extension host IPC churn.
  - Because both decorations use `after:`, `line.range.end` remains strictly before both decorations, keeping the cursor pinned cleanly at the end of the code without jumping or shifting across the avatar.
  - `avatarDecorationType`: `after: { width: '14px', height: '14px', margin: '0 6px 0 3em', textDecoration: 'none; vertical-align: middle' }`. Render options supply dynamic `contentIconPath: avatarUri`.
  - `textDecorationType`: `after: { color: new vscode.ThemeColor('gitGlance.inlineColor'), fontStyle: 'normal', textDecoration: 'none; vertical-align: middle' }`. Render options supply dynamic `contentText: inlineText` and `margin: hasAvatar ? '0' : '0 0 0 3em'`.
  - **Single `hoverMessage` Attachment Rule**: `hoverMessage` is attached strictly to `textDecorationType`. It MUST NOT be attached to `avatarDecorationType`. In Monaco, when multiple decoration types on the same line range specify `hoverMessage`, VS Code stacks all hover cards together, causing a duplicated/double hover popup.
- **Avatar Vertical Alignment (CSS Injection via `textDecoration`)**:
  - In VS Code's Extension Host, decoration options sent across RPC are strictly whitelisted by `fmt.from(e)` (`margin`, `width`, `height`, etc.), **dropping properties like `verticalAlign`**.
  - However, Monaco's CSS renderer on the renderer side DOES support `verticalAlign` via the template `"vertical-align:{0};"` and the `collectCSSText` function reads it from the resolved decoration object.
  - The `textDecoration` property survives the RPC bridge and is rendered via template `"text-decoration:{0};"` with simple `{0}` substitution and **no value sanitization**.
  - By setting `textDecoration: "none; vertical-align: middle"`, the CSS renderer produces `text-decoration: none; vertical-align: middle;` — effectively injecting `vertical-align` through the RPC bridge.
  - Both `avatarDecorationType` and `textDecorationType` use this technique so avatar and text align to the same vertical center.
  - **NEVER use `margin-bottom` negative values** for vertical alignment — they don't reliably center and cause line-height distortion.
  - To prevent line-height distortion, all avatar SVGs **MUST use native dimensions of exactly 14px × 14px** (`viewBox="0 0 14 14" width="14" height="14"`) with circle centered at `(7, 7)` and radius `7`.
  - Cache files use `_v5.svg` suffix to guarantee cache invalidation. Downloaded photos are requested at 28 px and wrapped with a single `href` (no `xlink:href` duplicate); `memoryCache` holds at most 200 keys.
- **Avatar Resolution Strategy**:
  1. Local initials SVG (14x14) generated synchronously for instant display.
  2. Background remote fetch waterfall, **only from sources tied to the commit email**: GitHub noreply email username -> GitHub commit API `repos/{owner}/{repo}/commits/{sha}` → `author.avatar_url` (github.com remotes only) -> Gravatar MD5.
  3. **NEVER guess a GitHub/GitLab handle from the author name.** `github.com/<name>.png` for a name like `John` or `admin` returns an unrelated account's photo.
  4. When every source answers "no photo", a `${hash}_none_v5` marker is written and the lookup is skipped for 7 days. Network errors, timeouts and rate limits (403/429) do not write the marker.
  5. Live reactive update: Once remote photo is downloaded and converted to 14x14 SVG, `AvatarService` notifies `GlanceController` via `onAvatarReady` to re-render the active editor line without requiring cursor movements.
- **Avatar Configuration & Toggle**:
  - `gitGlance.showAvatar` (boolean, default: `true`): Master switch to toggle avatar visibility.
  - `gitGlance.avatarSource` (`"remote"` | `"initials"`, default: `"remote"`): `"initials"` never touches the network and ignores previously downloaded photos.
  - `gitGlance.toggleAvatar` command: Quickly toggle avatar visibility on/off via Command Palette.
- **Colors**: Never hardcode hex colors in code. Always use `new vscode.ThemeColor('gitGlance.inlineColor')`, which falls back to theme-adaptive defaults defined in `package.json` (`#88888888` on dark, `#66666688` on light).
- **Default Visual Style (User Default)**:
  - Committed lines (current user): `(avatar) You, 3 days ago: ${message}` (avatar badge preserved for current user, author token replaced with `You`)
  - Committed lines (other authors): `(avatar) ${author}, ${time}: ${message}` (e.g. `(avatar) Linus Torvalds, 3 days ago: Add JWT middleware`)
  - Uncommitted / modified lines: `${author}, ${time}: ${message}` (e.g. `You, 3 hours ago: Uncommitted changes`) (strictly no avatar badge, no hover tooltip popup)
- **Current User Resolution & "You" Display**:
  - Automatically identifies whether the commit author matches the current Git user identity strictly via `git config user.email` (cached per repository in `currentUserEmailCache`). Validating exclusively by email eliminates false positives from common author names shared by different contributors.
  - When `isCurrentUser` is `true`, `${author}` token in inline text dynamically resolves to `"You"` across all presets.
  - The real author name and email remain preserved in `blame.author` and `blame.authorEmail`, guaranteeing that `AvatarService` generates and resolves the user's actual avatar badge (initials/remote photo).
  - Hover tooltips and details quick picks show `You (${blame.author})` for transparency and precision.
- **Supported Presets (`gitGlance.preset`)**:
  1. `default`: `(avatar) You, 3 days ago: Add JWT middleware` (or other author's name)
  2. `minimalist`: `· You, 3d ago — Add JWT middleware`
  3. `playful`: `👀 You, 3 days ago • 🚀 Add JWT middleware`
  4. `terminal`: `// git:You @ 7a8f3b2 (3d) "Add JWT middleware"`
  5. `github`: `@You, 3d ago: Add JWT middleware`
  6. `breadcrumb`: `› You › 3d ago › Add JWT middleware`
  7. `bento`: `⚡ You │ ⏱️ 3d ago │ 💬 Add JWT middleware`
  8. `comment`: `/* by You, 3d ago: Add JWT middleware */`
  9. `custom`: Uses custom `gitGlance.format` and `gitGlance.uncommittedFormat`.

### 3.2 Rich Interactive Hover Card

- Built with `vscode.MarkdownString` with `supportThemeIcons = true`, `isTrusted = { enabledCommands: ["gitGlance.copyHash", "gitGlance.showCommitDetails"] }`, and **`supportHtml = false`**.
- **Untrusted Text Rule**: author names, emails and commit messages come from other people. Always pass them through `escapeMarkdown` (escapes markdown syntax plus `<`, `>`, `&`). Never enable `supportHtml`: a commit message containing `<img src=...>` would load a remote image on hover. Use literal ` ` instead of `&nbsp;` for spacing.
- **Uncommitted Lines Policy**: Returns `undefined` so that no hover popup appears on uncommitted lines, keeping the editor distraction-free while typing.
- Uses native VS Code Codicons (`$(...)`) instead of emoticons or external SVGs:
  - Zero disk I/O, zero network, zero decoding latency (instant 0 ms render).
  - 100% theme-adaptive (automatically adjusts to dark, light, and high-contrast themes).
  - Native anchor styling in action links without layout or underline breaks.
- Layout:
  1. Header with title (`### Git Glance`).
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
- `${message}`: Commit subject summary, shortened to `gitGlance.maxMessageLength` code points with `…` (default `60`, `0` = no limit) via `truncateText`
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

- **Hybrid Blame Execution & Caching Strategy**:
  - **Documents $\le 2500$ lines (clean or dirty)**: `GitService` executes whole-file blame `git blame --porcelain -- <filePath>` once per document version (dirty buffers add `--contents -`) and populates all lines into memory. Subsequent cursor moves to any line in that version resolve in **0ms (instant memory lookup)** with **zero spawned subprocesses**.
  - **Large files ($> 2500$ lines) or files whose whole-file blame timed out** (`slowFullBlameFiles`): Uses targeted single-line blame `git blame -L <line>,<line> --porcelain -- <filePath>`. Lines in VS Code are 0-indexed; `git blame` is 1-indexed (always add +1).
  - `getBlameForLine` takes a `BlameRequest` whose `getText` is called lazily — only after a cache miss and **before the first `await`**, so the text always matches `documentVersion` and cache hits never copy the document.
- **Typed Git Errors & Timeouts**: `execGit` rejects with `GitCommandError` (`kind`: `aborted` | `timeout` | `exit` | `spawn`, plus `stderr`). Timeouts: whole-file blame 5 s, single-line blame 10 s, other commands 5 s (`GitService` constructor accepts overrides for tests).
  - Only `exit` / `spawn` errors are negative-cached. `aborted` and `timeout` are transient and never cached.
  - A whole-file `timeout` falls back to single-line blame immediately and marks the file in `slowFullBlameFiles`.
  - `fatal: file X has only N lines` (cursor on the trailing empty line) negative-caches **only that line key**, never the whole file version.
- **In-Flight Subprocess Cancellation (`AbortSignal`)**: Always pass an `AbortSignal` to `execGit`. When the user rapidly moves cursor or navigates lines, any pending `git blame` command for a previous line is immediately terminated with `proc.kill("SIGTERM")` to prevent queuing obsolete background processes. Whole-file blames own a separate `AbortController` (not tied to cursor moves) that `clearCache(file)` aborts.
- **`.git-blame-ignore-revs`** (`gitGlance.useIgnoreRevsFile`, default `true`): when the file exists at the repository root, blame adds `--ignore-revs-file <path>`. If git rejects it (`invalid object name` / `could not open object name list`), the blame is retried without it and the repo is added to `brokenIgnoreRevs`.
- **Remote Selection** (`gitGlance.remote`, default `""`): empty = `origin`, else the first remote from `git remote`. `GlanceController` pushes `remote`, `useIgnoreRevsFile`, and `commitUrlTemplate` to `GitService.setOptions`, which clears all caches when any of them change.
- **Zero-Debounce on Cache Hit**: In `GlanceController.onSelectionChange`, if the target line is already cached (`gitService.hasCachedBlame`), render the inline decoration immediately on the current event turn, bypassing the 100ms debounce timer for a snappy, instantaneous experience.
- **Cross-Platform Git Execution (Windows, macOS, Linux)**:
  - **Resolve git like VS Code**: never rely on a bare `git` being on `PATH`. After the built-in `vscode.git` extension activates, read `getAPI(1).git.path` and call `gitService.setGitPath` (clears all caches, including `repoRootCache`). Only API version `1` exists. `GitService.onGitMissing` fires once on a `spawn` error and `extension.ts` shows a warning with an "Open Settings" (`git.path`) button.
  - **Never cache transient failures**: `getRepoRoot` caches `null` only for `exit` errors (not a repository). `spawn`, `timeout` and `aborted` are never cached. `onDidOpenRepository` calls `resetRepoDiscovery()`.
  - **Paths**: git prints `C:/Users/x/repo`, VS Code uses `c:\Users\x\repo`. Convert git's output with `path.resolve`; compare paths only through `normalizeFsPath` / `isInsideDir` (`src/utils/paths.ts`, lower-cased on `win32`). Never use `startsWith(root + path.sep)`.
  - **Blame cwd**: blame runs with `cwd = path.dirname(file)` and `-- <basename>`, so drive-letter case, UNC and `subst` differences between VS Code and git can't break it. Commands that need the repository root use `getRepoRoot`.
  - **English git output**: spawn with `LC_ALL=C`; stderr checks (`has only N lines`, `invalid object name`) must not depend on the OS language.
  - **Diagnostics**: `GitService` takes an optional `GitLogger` (an Output channel "Git Glance" created lazily in `extension.ts`, opened by `gitGlance.showLog`). Each distinct message is logged once; expected failures (`BENIGN_STDERR`) are not logged. Ask Windows users for this log first.
  - **CI**: the matrix runs `ubuntu`, `windows` and `macos` (Node 20 and 22). `git-service.test.ts` must pass on all three; packaging runs on Ubuntu only.
- **Interactive Hanging Prevention**: Always execute git subprocesses with `GIT_TERMINAL_PROMPT: "0"` in the process environment to prevent background git commands from hanging indefinitely on credential or passphrase prompts.
- **Unsaved / Dirty Document Handling**: When the document is dirty (`document.isDirty`), pass document contents through stdin using `--contents -`.
- **Synthesized Blame While Typing**: when an edit touches the active line, that line already showed a blame (proves the file is tracked), and the document is still dirty, `GlanceController` renders `createUncommittedBlame(line)` immediately **without spawning git**. If the edit makes the buffer clean again (undo to saved state), it falls back to a debounced real blame.
- **Accurate Uncommitted Timestamps via `fs.stat.mtime`**: Git's internal C implementation of `git blame` assigns `time(NULL)` (`Date.now()`) to all uncommitted lines. To prevent uncommitted lines from perpetually displaying `"just now"` across editor re-blames, `GitService` reads `(await fs.promises.stat(filePath)).mtime` when `isUncommitted && !isDirty`. When the document is dirty in memory, it reflects the active typing session, and once saved, preserves the actual disk file modification timestamp (e.g. `3 hours ago`, `yesterday`).
- **Real-Time Active Line Editing Reactivity**: Listen to `vscode.workspace.onDidChangeTextDocument` to immediately detect edits affecting the current active line, invalidating the current blame and scheduling a debounced re-blame so uncommitted status (`uncommitted changes`) displays in real time without waiting for cursor line jumps.
- **In-Memory Caching, Invalidation & Cleanup**:
  - Two small LRU caches (re-inserted on every hit): `fileBlameCache` holds one `Map<line, BlameInfo>` per `${filePath}:${documentVersion}` (16 entries), `lineBlameCache` holds single-line blames of large or slow files keyed by `${filePath}:${documentVersion}:${line}` (300 entries). Never cache per line for whole-file blames: many lines per file made tabs evict each other and re-run `git blame`.
  - A cached whole-file blame that lacks a line means the line is past the end of the file; return `null` without spawning git.
  - `clearCache(file)` drops every key with the `${filePath}:` prefix from both caches (at most ~316 entries, so a linear scan is fine).
  - The remote URL is parsed once per blame (`BlameContext.remote`) and web URLs are memoized per sha in `BlameContext.commitUrls`; call `commitUrlFromParsed`, not `commitWebUrl`, in per-line code.
  - In-flight promise deduplication: `pendingFullBlame` (`Map<string, { promise, controller }>`) de-duplicates concurrent full-file blame runs for the same file version without being aborted by rapid cursor navigation.
  - Negative caching: `failedBlame` (`Set<string>`) caches un-blameable / untracked / ignored files per version (`${file}:${version}`) or single lines (`${file}:${version}:${line}`) to prevent spawning git subprocesses on every cursor move.
  - **Generation Counter**: `clearCache(file)` bumps a per-file generation and `clearCache()` a global one. Every blame captures the generation before its first `await` and only writes to the blame caches / `failedBlame` if it is unchanged, so a result that finishes after a cache clear can't write stale data back.
  - Invalidate file cache on document save (`onDidSaveTextDocument`) and active document modification (`onDidChangeTextDocument`).
  - **External Commits (`vscode.git` API)**: `repo.state.onDidChange` fires on every status refresh (saves, window focus, any working tree change). **NEVER clear caches on every event.** `watchExternalCommits` in `extension.ts` tracks `repo.state.HEAD?.commit` per repository and calls `gitService.clearRepoCache(repo.rootUri.fsPath)` only when HEAD changes. All listeners are pushed to `context.subscriptions`.
  - Evict file cache on document close (`onDidCloseTextDocument`) to prevent memory leaks during long coding sessions.
  - Directory repository root caching: `repoRootCache` caches resolved repository roots per directory to prevent repeated `git rev-parse --show-toplevel` calls while guaranteeing 100% submodule and worktree safety.
  - Await `getRemoteBaseUrl` and `getCurrentUserEmail` resolution concurrently via `Promise.all` so `remoteCommitUrl` and `isCurrentUser` are immediately available on initial hover render and avatar lookups.
  - Cache repository-level Git current user email (`user.email`) in `currentUserEmailCache` to avoid spawning redundant git subprocesses on every line blame.
- **Debouncing & Battery Preservation**:
  - Cursor line changes without a cache hit use default `100ms` debounce (`gitGlance.delay`).
  - Active-line document edits use extended debounce ($\ge 300\text{ms}$) and immediately cancel in-flight git processes to avoid battery-draining subprocess churn during rapid typing.
- **Race Condition & Boundary Prevention**:
  - After awaiting an async git operation, always verify that `!signal.aborted`, `vscode.window.activeTextEditor === editor`, and `editor.selection.active.line === line` before setting decorations.
  - Always guard against out-of-bounds line numbers (`blame.line < 0 || blame.line >= editor.document.lineCount`) before accessing `editor.document.lineAt`.
- **Token Replacement Safety**: Use single-pass regular expression token replacements to prevent recursive or cascading substitutions if commit messages or author names contain format token strings (e.g. `${author}`, `${hash}`).
- **Remote Provider URL Resolution & Custom Templates**:
  - Pure URL parsing and formatting resides in `src/utils/remote.ts` (`commitWebUrl`).
  - Automatic SSH alias and port proxy host normalization: `altssh.bitbucket.org` -> `bitbucket.org`, `ssh.github.com` -> `github.com`, `altssh.gitlab.com` -> `gitlab.com`, `ssh.dev.azure.com` -> `dev.azure.com`.
  - Zero-configuration auto-detection for all common Git hosting providers:
    - **Bitbucket Cloud**: `https://bitbucket.org/<workspace>/<repo>/commits/<sha>` (handles SSH, HTTPS, altssh port 443, trailing slashes, and scp-style).
    - **Bitbucket Server / Data Center**: `https://<host>[/<context>]/projects/<PROJ>/repos/<repo>/commits/<sha>` (auto-strips `/scm/` path segments, handles non-standard HTTP/HTTPS ports, and converts personal `~user` repositories to `/users/<user>/repos/<repo>/commits/<sha>`).
    - **GitHub**: `https://<host>/<path>/commit/<sha>` (public and GitHub Enterprise).
    - **GitLab**: `https://<host>/<path>/-/commit/<sha>` (public, self-hosted, and deep subgroups).
    - **Azure DevOps**: `https://dev.azure.com/<org>/<proj>/_git/<repo>/commit/<sha>`.
    - **AWS CodeCommit**: `https://<region>.console.aws.amazon.com/codesuite/codecommit/repositories/<repo>/commit/<sha>?region=<region>`.
    - **Generic Web Git**: Codeberg, Gitea, Forgejo, SourceHut (`git.sr.ht`), Gitee -> `https://<host>/<path>/commit/<sha>`.
  - `parseRemoteUrl` percent-encodes every path segment exactly once (`encodePath`, decoding first so URL-style remotes aren't double-encoded, and escaping `(` `)`). Paths containing `/_git/` are Azure DevOps even on unknown hosts (TFS / Azure DevOps Server).
  - Sensitive credential stripping: all token/username:password credentials embedded in remote URLs are stripped before generating browser links.
  - `gitGlance.commitUrlTemplate`: Optional escape hatch allowing users to supply custom templates (e.g. `https://${host}/custom/${project}/${repo}/commit/${sha}`) with `${host}`, `${path}`, `${sha}`, `${shortSha}`, `${project}`, `${repo}` tokens. Replaced via single-pass regex and validated for `http(s)://` security.
- **Configuration Changes**: `toggle` / `toggleAvatar` only write the setting; `onDidChangeConfiguration` → `reloadConfig` re-renders. Configuration changes never recreate decoration types.
- **Testing GitService**: `src/test/git-service.test.ts` creates real repos under `fs.realpathSync(os.tmpdir())` and sets `GIT_CONFIG_GLOBAL=os.devNull` / `GIT_CONFIG_NOSYSTEM=1` so the developer's git config (commit signing, ignore-revs) can't affect results. Add a test there for every change to blame execution, caching, or error handling.

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
- **Package Size Verification**: The built `.vsix` file MUST stay ultra-compact (target under ~35 KB with icon; currently ~41 KB, already above target). Report the size whenever it grows. Keep non-runtime assets, tests, and source code ignored in `.vscodeignore`.

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

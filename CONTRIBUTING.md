# Contributing to Git Glance

Thank you for your interest in contributing to **Git Glance**! 🎉

We welcome contributions of all kinds: bug fixes, performance optimizations, new presets, documentation improvements, and thoughtful discussions.

---

## Code of Conduct

This project is governed by the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Development Prerequisites

Before you start, make sure you have installed:

- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **pnpm**: Fast, disk space efficient package manager (`corepack enable` or `npm install -g pnpm`)
- **VS Code**: `v1.85.0` or newer
- **Git**: Installed and available in your shell `PATH`

---

## Local Development Workflow

### 1. Clone & Install

```bash
git clone https://github.com/ridiansyah/git-glance.git
cd git-glance
pnpm install
```

### 2. Launching the Extension Debugger

1. Open the project folder in VS Code:
   ```bash
   code .
   ```
2. Press **`F5`** (or go to **Run & Debug** and choose **`Launch Git Glance`**).
3. A new **Extension Development Host** VS Code window will open with Git Glance active.
4. Open any file in a Git repository to test inline blame annotations!

### 3. Available Scripts

| Command                 | Description                                                         |
| :---------------------- | :------------------------------------------------------------------ |
| `pnpm run compile`      | Bundles the extension with `esbuild` into `dist/extension.js`.      |
| `pnpm run watch`        | Starts `esbuild` in watch mode for fast live reloading during dev.  |
| `pnpm run lint`         | Runs TypeScript compiler (`tsc --noEmit`) to verify types.          |
| `pnpm test`             | Runs unit tests using Node.js built-in test runner (`node:test`).   |
| `pnpm run package`      | Produces a minified production bundle.                              |
| `pnpm run package:vsix` | Packages the extension into a local `.vsix` installer using `vsce`. |

---

## Architectural & Engineering Standards

To keep Git Glance ultra-fast, robust, and maintainable, please follow these guidelines:

### 1. File Naming Convention (Strict Kebab-Case)

- All source files and directories **must use kebab-case** (e.g. `glance-controller.ts`, `unit.test.ts`).
- Never introduce camelCase or PascalCase file names.

### 2. Zero Runtime Dependencies & Small Bundle Size

- Git Glance maintains a hard constraint of **zero external runtime dependencies**.
- Bundled output must remain tiny (under ~35 KB unminified, ~15 KB `.vsix`).

### 3. Performance & Editor Responsiveness

- All editor cursor movements must remain debounced (configurable via `gitGlance.delay`, defaulting to 100ms).
- Never block the UI thread with synchronous operations.
- Always check that the active editor and active line have not changed before applying asynchronous decoration updates.

### 4. Theme & Visual Consistency

- Never hardcode color hex codes for text decorations. Always use `vscode.ThemeColor('gitGlance.inlineColor')`.
- All icons and badges should scale cleanly and respect dark/light high-contrast themes.

### 5. Automated Tests

- If you introduce a utility, parser, or template helper, please add a unit test in `src/test/unit.test.ts`.
- Ensure `pnpm run lint && pnpm test` passes before opening a PR.

---

## Submitting a Pull Request

1. **Fork** the repository and create your feature branch:
   ```bash
   git checkout -b feature/awesome-new-preset
   ```
2. Make your changes adhering to the guidelines above.
3. Verify that everything builds and passes tests:
   ```bash
   pnpm run compile
   pnpm run lint
   pnpm test
   pnpm run package:vsix
   ```
4. Push your branch to GitHub and submit a **Pull Request**.
5. Provide a clear description of the problem solved or feature added, including screenshots or GIFs if the change affects visual styles.

Thank you for helping make Git Glance better for everyone! 🚀

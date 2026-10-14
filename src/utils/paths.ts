import * as path from "path";

type Platform = NodeJS.Platform;

function pathApi(platform: Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Normalizes a filesystem path for comparison: native separators, no trailing separator,
 * and lower-cased on Windows where the filesystem ignores case.
 * Git reports `C:/Users/x`, VS Code reports `c:\Users\x`; both normalize to the same value.
 */
export function normalizeFsPath(
  fsPath: string,
  platform: Platform = process.platform,
): string {
  const api = pathApi(platform);
  const normalized = api.normalize(fsPath);
  const root = api.parse(normalized).root;
  const trimmed =
    normalized.length > root.length
      ? normalized.replace(/[\\/]+$/, "")
      : normalized;
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/** True when `file` is `dir` itself or lies below it. */
export function isInsideDir(
  dir: string,
  file: string,
  platform: Platform = process.platform,
): boolean {
  const api = pathApi(platform);
  const normalizedDir = normalizeFsPath(dir, platform);
  const normalizedFile = normalizeFsPath(file, platform);
  if (normalizedFile === normalizedDir) {
    return true;
  }
  const prefix = normalizedDir.endsWith(api.sep)
    ? normalizedDir
    : normalizedDir + api.sep;
  return normalizedFile.startsWith(prefix);
}

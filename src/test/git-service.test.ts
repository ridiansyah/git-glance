import test from "node:test";
import * as assert from "node:assert";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../git";
import { BlameRequest } from "../types";

// Keep the developer's global git config (signing, ignore-revs, ...) out of these tests.
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const ME = { name: "Test Author", email: "author@example.com" };
const BOT = { name: "Formatter Bot", email: "bot@example.com" };

function git(cwd: string, args: string[], who = ME): string {
  return cp.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
    },
  });
}

/** Repo with `a.txt` = "one\ntwo\nthree\n" committed as "init" by ME. */
function createRepo(): { root: string; file: string; cleanup: () => void } {
  // realpath: macOS tmpdir is a symlink, and git reports the resolved root.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "git-glance-test-")),
  );
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", ME.email]);
  git(root, ["config", "commit.gpgsign", "false"]);
  const file = path.join(root, "a.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-qm", "init"]);
  return {
    root,
    file,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function request(
  file: string,
  line: number,
  overrides: Partial<BlameRequest> = {},
): BlameRequest {
  return {
    filePath: file,
    line,
    documentVersion: 1,
    lineCount: 4, // VS Code counts the empty line after the final newline
    isDirty: false,
    getText: () => fs.readFileSync(file, "utf8"),
    ...overrides,
  };
}

test("GitService - clean file is blamed whole and cached", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    const blame = await gitService.getBlameForLine(request(file, 1));
    assert.ok(blame);
    assert.strictEqual(blame.author, ME.name);
    assert.strictEqual(blame.summary, "init");
    assert.strictEqual(blame.isUncommitted, false);
    assert.strictEqual(blame.isCurrentUser, true);
    assert.strictEqual(gitService.hasCachedBlame(file, 1, 0), true);
    assert.strictEqual(gitService.hasCachedBlame(file, 1, 2), true);

    // The trailing empty line has no blame, but doesn't break the others
    assert.strictEqual(await gitService.getBlameForLine(request(file, 3)), null);
    assert.ok(await gitService.getBlameForLine(request(file, 0)));
  } finally {
    cleanup();
  }
});

test("GitService - dirty buffer is blamed whole via --contents and read once", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    let reads = 0;
    const dirty = {
      documentVersion: 2,
      isDirty: true,
      getText: () => {
        reads++;
        return "one\nTWO\nthree\n";
      },
    };

    const edited = await gitService.getBlameForLine(request(file, 1, dirty));
    assert.ok(edited);
    assert.strictEqual(edited.isUncommitted, true);
    assert.strictEqual(edited.author, "You");

    const untouched = await gitService.getBlameForLine(request(file, 0, dirty));
    assert.ok(untouched);
    assert.strictEqual(untouched.summary, "init");
    assert.strictEqual(reads, 1, "second line should be a cache hit");
  } finally {
    cleanup();
  }
});

test("GitService - trailing empty line of a large dirty file doesn't hide other lines", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    // lineCount > 2500 forces single-line blame
    const dirty = {
      documentVersion: 2,
      isDirty: true,
      lineCount: 3000,
      getText: () => "one\ntwo\nthree\n",
    };
    assert.strictEqual(await gitService.getBlameForLine(request(file, 3, dirty)), null);
    const blame = await gitService.getBlameForLine(request(file, 0, dirty));
    assert.ok(blame);
    assert.strictEqual(blame.summary, "init");
  } finally {
    cleanup();
  }
});

test("GitService - untracked file returns null", async () => {
  const { root, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    const untracked = path.join(root, "new.txt");
    fs.writeFileSync(untracked, "hello\n");
    assert.strictEqual(await gitService.getBlameForLine(request(untracked, 0)), null);
    assert.strictEqual(await gitService.getBlameForLine(request(untracked, 0)), null);
  } finally {
    cleanup();
  }
});

test("GitService - saved uncommitted line uses the file mtime", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    fs.writeFileSync(file, "one\ntwo\nthree\nfour\n");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(file, twoHoursAgo, twoHoursAgo);

    const blame = await gitService.getBlameForLine(
      request(file, 3, { lineCount: 5 }),
    );
    assert.ok(blame);
    assert.strictEqual(blame.isUncommitted, true);
    assert.ok(Math.abs(blame.authorDate.getTime() - twoHoursAgo.getTime()) < 2000);
  } finally {
    cleanup();
  }
});

test("GitService - whole-file timeout falls back to single-line blame", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService({ fullBlameMs: 1 });
    const blame = await gitService.getBlameForLine(request(file, 0));
    assert.ok(blame, "single-line fallback should still return a blame");
    assert.strictEqual(blame.summary, "init");
    // Only the requested line is cached; the file stays on single-line blame
    assert.strictEqual(gitService.hasCachedBlame(file, 1, 2), false);
    const next = await gitService.getBlameForLine(request(file, 2));
    assert.ok(next);
  } finally {
    cleanup();
  }
});

test("GitService - honors .git-blame-ignore-revs, and survives a malformed one", async () => {
  const { root, file, cleanup } = createRepo();
  try {
    fs.writeFileSync(file, "ONE\ntwo\nthree\n");
    git(root, ["commit", "-qam", "reformat"], BOT);
    const reformatSha = git(root, ["rev-parse", "HEAD"]).trim();
    const ignoreRevs = path.join(root, ".git-blame-ignore-revs");
    fs.writeFileSync(ignoreRevs, `# formatting\n${reformatSha}\n`);

    const gitService = new GitService();
    const ignored = await gitService.getBlameForLine(request(file, 0));
    assert.ok(ignored);
    assert.strictEqual(ignored.summary, "init");

    gitService.setOptions({ remoteName: "", useIgnoreRevsFile: false });
    const plain = await gitService.getBlameForLine(request(file, 0));
    assert.ok(plain);
    assert.strictEqual(plain.summary, "reformat");
    assert.strictEqual(plain.author, BOT.name);
    assert.strictEqual(plain.isCurrentUser, false);

    fs.writeFileSync(ignoreRevs, "not-a-sha\n");
    gitService.setOptions({ remoteName: "", useIgnoreRevsFile: true });
    const fallback = await gitService.getBlameForLine(request(file, 0));
    assert.ok(fallback, "a malformed ignore-revs file must not break blame");
    assert.strictEqual(fallback.summary, "reformat");
  } finally {
    cleanup();
  }
});

test("GitService - remote selection", async () => {
  const { root, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    assert.strictEqual(await gitService.getRemoteBaseUrl(root), null);

    git(root, ["remote", "add", "upstream", "git@github.com:acme/upstream.git"]);
    gitService.clearRepoCache(root);
    assert.strictEqual(
      await gitService.getRemoteBaseUrl(root),
      "git@github.com:acme/upstream.git",
    );

    git(root, ["remote", "add", "origin", "https://github.com/me/fork.git"]);
    gitService.clearRepoCache(root);
    assert.strictEqual(
      await gitService.getRemoteBaseUrl(root),
      "https://github.com/me/fork.git",
    );

    gitService.setOptions({ remoteName: "upstream", useIgnoreRevsFile: true });
    assert.strictEqual(
      await gitService.getRemoteBaseUrl(root),
      "git@github.com:acme/upstream.git",
    );
  } finally {
    cleanup();
  }
});

test("GitService - clearRepoCache only drops that repository", async () => {
  const a = createRepo();
  const b = createRepo();
  try {
    const gitService = new GitService();
    await gitService.getBlameForLine(request(a.file, 0));
    await gitService.getBlameForLine(request(b.file, 0));

    gitService.clearRepoCache(a.root);
    assert.strictEqual(gitService.hasCachedBlame(a.file, 1, 0), false);
    assert.strictEqual(gitService.hasCachedBlame(b.file, 1, 0), true);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test("GitService - a blame finishing after clearCache isn't cached", async () => {
  const { file, cleanup } = createRepo();
  try {
    const gitService = new GitService();
    const pending = gitService.getBlameForLine(request(file, 0));
    gitService.clearCache(file);
    await pending;
    assert.strictEqual(gitService.hasCachedBlame(file, 1, 0), false);
  } finally {
    cleanup();
  }
});

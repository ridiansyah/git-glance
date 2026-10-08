import test from "node:test";
import * as assert from "node:assert";
import { formatRelativeTime, formatCustomDate } from "../utils/date";
import { GitService } from "../git";
import { formatInlineText } from "../utils/format";
import { GitGlanceConfig } from "../types";
import { AvatarService } from "../utils/avatar";

test("Date utilities - formatRelativeTime", () => {
  const now = new Date("2026-09-28T12:00:00Z");

  // 10 seconds ago
  const t10s = new Date(now.getTime() - 10 * 1000);
  assert.strictEqual(formatRelativeTime(t10s, now), "just now");

  // 45 seconds ago
  const t45s = new Date(now.getTime() - 45 * 1000);
  assert.strictEqual(formatRelativeTime(t45s, now), "45s ago");

  // 5 minutes ago
  const t5m = new Date(now.getTime() - 5 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t5m, now), "5m ago");

  // 2 hours ago
  const t2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t2h, now), "2 hours ago");

  // 1 day ago
  const t1d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t1d, now), "yesterday");

  // 3 days ago
  const t3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t3d, now), "3 days ago");

  // 2 months ago
  const t2mo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t2mo, now), "2 months ago");

  // 360 days ago (close to 1 year, must not be "0 years ago")
  const t360d = new Date(now.getTime() - 360 * 24 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t360d, now), "1 year ago");

  // 2 years ago
  const t2y = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  assert.strictEqual(formatRelativeTime(t2y, now), "2 years ago");
});

test("Date utilities - formatCustomDate", () => {
  // Test afternoon date: 2026-09-25 14:10:05 (Friday)
  const afternoonDate = new Date(2026, 8, 25, 14, 10, 5);

  // Default format: DD/MM/YYYY HH:mm
  assert.strictEqual(formatCustomDate(afternoonDate), "25/09/2026 14:10");
  assert.strictEqual(
    formatCustomDate(afternoonDate, "DD/MM/YYYY HH:mm"),
    "25/09/2026 14:10",
  );

  // ISO style
  assert.strictEqual(
    formatCustomDate(afternoonDate, "YYYY-MM-DD HH:mm"),
    "2026-09-25 14:10",
  );

  // 12-hour style with AM/PM
  assert.strictEqual(
    formatCustomDate(afternoonDate, "DD/MM/YYYY hh:mm:ss A"),
    "25/09/2026 02:10:05 PM",
  );
  assert.strictEqual(
    formatCustomDate(afternoonDate, "D/M/YY h:m:s a"),
    "25/9/26 2:10:5 pm",
  );

  // Words & escaped brackets
  assert.strictEqual(
    formatCustomDate(afternoonDate, "dddd, DD MMMM YYYY [at] HH:mm"),
    "Friday, 25 September 2026 at 14:10",
  );
  assert.strictEqual(
    formatCustomDate(afternoonDate, "ddd, DD MMM YYYY"),
    "Fri, 25 Sep 2026",
  );

  // Test morning date: 2026-01-05 08:05:02 (Monday)
  const morningDate = new Date(2026, 0, 5, 8, 5, 2);
  assert.strictEqual(
    formatCustomDate(morningDate, "DD/MM/YYYY HH:mm"),
    "05/01/2026 08:05",
  );
  assert.strictEqual(
    formatCustomDate(morningDate, "D/M/YYYY h:m a"),
    "5/1/2026 8:5 am",
  );
  assert.strictEqual(
    formatCustomDate(morningDate, "dddd, MMMM D, YYYY"),
    "Monday, January 5, 2026",
  );

  // Fallback on empty or invalid input
  assert.strictEqual(formatCustomDate(morningDate, ""), "05/01/2026 08:05");
  assert.strictEqual(formatCustomDate(new Date(NaN)), "");
});

test("GitService - formatCommitWebUrl", () => {
  const gitService = new GitService();

  // GitHub SSH
  const ghSsh = gitService.formatCommitWebUrl(
    "git@github.com:ridiansyah/git-glance.git",
    "abc1234",
  );
  assert.strictEqual(
    ghSsh,
    "https://github.com/ridiansyah/git-glance/commit/abc1234",
  );

  // GitHub HTTPS
  const ghHttps = gitService.formatCommitWebUrl(
    "https://github.com/ridiansyah/git-glance.git",
    "abc1234",
  );
  assert.strictEqual(
    ghHttps,
    "https://github.com/ridiansyah/git-glance/commit/abc1234",
  );

  // GitLab SSH
  const glSsh = gitService.formatCommitWebUrl(
    "git@gitlab.com:ridiansyah/git-glance.git",
    "abc1234",
  );
  assert.strictEqual(
    glSsh,
    "https://gitlab.com/ridiansyah/git-glance/-/commit/abc1234",
  );

  // Bitbucket
  const bb = gitService.formatCommitWebUrl(
    "git@bitbucket.org:org/repo.git",
    "abc1234",
  );
  assert.strictEqual(bb, "https://bitbucket.org/org/repo/commits/abc1234");

  // Credential stripping (token security)
  const credentialUrl = gitService.formatCommitWebUrl(
    "https://oauth2:ghp_SECRET_TOKEN_12345@github.com/myorg/myrepo.git",
    "abc1234",
  );
  assert.strictEqual(
    credentialUrl,
    "https://github.com/myorg/myrepo/commit/abc1234",
  );

  // False-positive GitLab URL on GitHub (github.com repo named gitlab-tools)
  const ghGitLabTools = gitService.formatCommitWebUrl(
    "https://github.com/acme/gitlab-tools.git",
    "abc1234",
  );
  assert.strictEqual(
    ghGitLabTools,
    "https://github.com/acme/gitlab-tools/commit/abc1234",
  );

  // ssh:// format with port
  const sshWithPort = gitService.formatCommitWebUrl(
    "ssh://git@gitlab.company.com:2222/group/project.git",
    "abc1234",
  );
  assert.strictEqual(
    sshWithPort,
    "https://gitlab.company.com/group/project/-/commit/abc1234",
  );
});

test("FormatPresets - default and presets", () => {
  const mockBlame = {
    sha: "1234567890abcdef",
    shortSha: "1234567",
    author: "Wahyu Ridiansyah",
    authorEmail: "wahyu@example.com",
    authorDate: new Date("2026-09-25T10:00:00Z"),
    authorTimeZone: "+0000",
    committer: "Wahyu Ridiansyah",
    committerEmail: "wahyu@example.com",
    committerDate: new Date("2026-09-25T10:00:00Z"),
    summary: "Add JWT middleware",
    line: 10,
    isUncommitted: false,
  };

  const uncommittedBlame = {
    ...mockBlame,
    sha: "0000000000000000000000000000000000000000",
    shortSha: "0000000",
    author: "You",
    summary: "Uncommitted changes",
    isUncommitted: true,
  };

  const baseConfig: GitGlanceConfig = {
    enabled: true,
    preset: "default",
    showAvatar: true,
    prefix: "",
    format: "${author}, ${time}: ${message}",
    uncommittedFormat: "${author}, ${time}: ${message}",
    dateStyle: "short",
    hoverDateFormat: "DD/MM/YYYY HH:mm",
    delay: 100,
    showHover: true,
  };

  // 1. Default preset
  const defaultText = formatInlineText(mockBlame, baseConfig);
  assert.strictEqual(defaultText.includes("Wahyu Ridiansyah, "), true);
  assert.strictEqual(defaultText.includes("Add JWT middleware"), true);
  const uncommittedDefault = formatInlineText(uncommittedBlame, baseConfig);
  assert.strictEqual(uncommittedDefault.startsWith("You, "), true);
  assert.strictEqual(
    uncommittedDefault.endsWith(": Uncommitted changes"),
    true,
  );

  // 2. Minimalist preset (Option 1)
  const minText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "minimalist",
  });
  assert.strictEqual(minText.startsWith("· Wahyu Ridiansyah,"), true);
  const uncommittedMin = formatInlineText(uncommittedBlame, {
    ...baseConfig,
    preset: "minimalist",
  });
  assert.strictEqual(uncommittedMin.startsWith("· You, "), true);
  assert.strictEqual(uncommittedMin.endsWith(" — Uncommitted changes"), true);

  // 3. Playful preset (Option 3)
  const playfulText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "playful",
  });
  assert.strictEqual(playfulText.includes("👀 Wahyu Ridiansyah,"), true);
  assert.strictEqual(playfulText.includes("🚀 Add JWT middleware"), true);

  // 4. Terminal preset (Option 4)
  const termText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "terminal",
  });
  assert.strictEqual(
    termText.includes("// git:Wahyu Ridiansyah @ 1234567"),
    true,
  );

  // 5. GitHub preset (Option 5)
  const ghText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "github",
  });
  assert.strictEqual(ghText.includes("@Wahyu Ridiansyah, "), true);

  // 6. Breadcrumb preset (Option 6)
  const breadText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "breadcrumb",
  });
  assert.strictEqual(breadText.includes("› Wahyu Ridiansyah ›"), true);

  // 7. Bento preset (Option 7)
  const bentoText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "bento",
  });
  assert.strictEqual(bentoText.includes("⚡ Wahyu Ridiansyah │"), true);

  // 8. Comment preset (Option 8)
  const commentText = formatInlineText(mockBlame, {
    ...baseConfig,
    preset: "comment",
  });
  assert.strictEqual(commentText.startsWith("/* by Wahyu Ridiansyah,"), true);

  // 9. Custom preset (Freely defined format by user)
  const customConfig: GitGlanceConfig = {
    ...baseConfig,
    preset: "custom",
    format: "[${hash}] ${author} (${authorEmail}) - ${message}",
    uncommittedFormat: "✍️ ${author}: ${message}",
  };
  const customText = formatInlineText(mockBlame, customConfig);
  assert.strictEqual(
    customText,
    "[1234567] Wahyu Ridiansyah (wahyu@example.com) - Add JWT middleware",
  );
  const customUncommitted = formatInlineText(uncommittedBlame, customConfig);
  assert.strictEqual(customUncommitted, "✍️ You: Uncommitted changes");

  // 10. Current User detection formatting (swaps author name to You)
  const currentUserBlame = {
    ...mockBlame,
    isCurrentUser: true,
  };
  const currentUserDefaultText = formatInlineText(currentUserBlame, baseConfig);
  assert.strictEqual(currentUserDefaultText.startsWith("You, "), true);
  assert.strictEqual(
    currentUserDefaultText.includes("Add JWT middleware"),
    true,
  );
  assert.strictEqual(
    currentUserDefaultText.includes("Wahyu Ridiansyah"),
    false,
  );

  const currentUserTerminalText = formatInlineText(currentUserBlame, {
    ...baseConfig,
    preset: "terminal",
  });
  assert.strictEqual(
    currentUserTerminalText.includes("// git:You @ 1234567"),
    true,
  );

  const currentUserCustom = formatInlineText(currentUserBlame, customConfig);
  assert.strictEqual(
    currentUserCustom,
    "[1234567] You (wahyu@example.com) - Add JWT middleware",
  );
});

test("GitService - isCurrentUser matching", () => {
  const gitService = new GitService();
  const currentUserEmail = "wahyuridiansyah@gmail.com";

  // 1. Matches by exact email
  assert.strictEqual(
    gitService.isCurrentUser("wahyuridiansyah@gmail.com", currentUserEmail),
    true,
  );

  // 2. Matches by case-insensitive email
  assert.strictEqual(
    gitService.isCurrentUser("Wahyuridiansyah@Gmail.Com", currentUserEmail),
    true,
  );

  // 3. Handles email with surrounding quotes or whitespace
  assert.strictEqual(
    gitService.isCurrentUser(' "wahyuridiansyah@gmail.com" ', currentUserEmail),
    true,
  );

  // 4. Does not match different email (prevents collision across people with same name)
  assert.strictEqual(
    gitService.isCurrentUser("another.person@example.com", currentUserEmail),
    false,
  );

  // 5. Handles null or empty currentUserEmail
  assert.strictEqual(
    gitService.isCurrentUser("wahyu@example.com", null),
    false,
  );
  assert.strictEqual(gitService.isCurrentUser("wahyu@example.com", ""), false);
  assert.strictEqual(gitService.isCurrentUser("", currentUserEmail), false);
});

test("AvatarService - Initials and SVG generation", () => {
  const avatarService = new AvatarService("/tmp");
  assert.strictEqual(avatarService.extractInitials("Wahyu Ridiansyah"), "WR");
  assert.strictEqual(avatarService.extractInitials("Draculabo"), "DR");
  assert.strictEqual(avatarService.extractInitials("Jane"), "JA");
  assert.strictEqual(avatarService.extractInitials(""), "GL");

  const svg = avatarService.generateInitialsSvg(
    "Wahyu Ridiansyah",
    "wahyu@example.com",
  );
  assert.strictEqual(svg.includes("<circle"), true);
  assert.strictEqual(svg.includes(">WR<"), true);
  assert.strictEqual(svg.includes('width="14"'), true);
  assert.strictEqual(svg.includes('height="14"'), true);
  assert.strictEqual(svg.includes('viewBox="0 0 14 14"'), true);

  const wrapped = avatarService.wrapImageInSvg("SGVsbG8=", "image/png");
  assert.strictEqual(wrapped.includes('width="14"'), true);
  assert.strictEqual(wrapped.includes('height="14"'), true);
  assert.strictEqual(wrapped.includes('viewBox="0 0 14 14"'), true);
  assert.strictEqual(wrapped.includes("clipPath"), true);
  assert.strictEqual(wrapped.includes("data:image/png;base64,SGVsbG8="), true);

  const key1 = avatarService.getAvatarKey(
    "Draculabo",
    "draculabo@example.com",
    false,
  );
  assert.strictEqual(key1, "draculabo@example.com");

  const key2 = avatarService.getAvatarKey("Draculabo", "", false);
  assert.strictEqual(key2, "draculabo");

  const keyUncommitted = avatarService.getAvatarKey("You", "", true);
  assert.strictEqual(keyUncommitted, "__you__");
});

test("GitService - parsePorcelain multi-line and single-line stream parsing", () => {
  const gitService = new GitService();

  // 1. Single-line porcelain mock
  const singleLineOutput = `9b595a4235b06f7ee62071b568e833672ec06295 1 1 1
author Wahyu Ridiansyah
author-mail <wahyuridiansyah@gmail.com>
author-time 1790599131
author-tz +0700
committer Wahyu Ridiansyah
committer-mail <wahyuridiansyah@gmail.com>
committer-time 1790599131
committer-tz +0700
summary Initial commit
filename package.json
\t{`;

  const singleResult = gitService.parsePorcelain(singleLineOutput, "/mock/repo");
  assert.strictEqual(singleResult.size, 1);
  const blame0 = singleResult.get(0);
  assert.ok(blame0);
  assert.strictEqual(blame0.sha, "9b595a4235b06f7ee62071b568e833672ec06295");
  assert.strictEqual(blame0.author, "Wahyu Ridiansyah");
  assert.strictEqual(blame0.authorEmail, "wahyuridiansyah@gmail.com");
  assert.strictEqual(blame0.summary, "Initial commit");
  assert.strictEqual(blame0.line, 0);
  assert.strictEqual(blame0.isUncommitted, false);

  // 2. Multi-line porcelain with shared commits
  const multiLineOutput = `9b595a4235b06f7ee62071b568e833672ec06295 1 1 2
author Wahyu Ridiansyah
author-mail <wahyuridiansyah@gmail.com>
author-time 1790599131
author-tz +0700
committer Wahyu Ridiansyah
committer-mail <wahyuridiansyah@gmail.com>
committer-time 1790599131
committer-tz +0700
summary Initial commit
filename test.ts
\tline 1
9b595a4235b06f7ee62071b568e833672ec06295 2 2
\tline 2
0000000000000000000000000000000000000000 3 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1790600000
author-tz +0700
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1790600000
committer-tz +0700
summary Version of test.ts
filename test.ts
\tline 3`;

  const multiResult = gitService.parsePorcelain(multiLineOutput, "/mock/repo");
  assert.strictEqual(multiResult.size, 3);

  // Line 0 (finalLine 0)
  const l0 = multiResult.get(0);
  assert.ok(l0);
  assert.strictEqual(l0.sha, "9b595a4235b06f7ee62071b568e833672ec06295");
  assert.strictEqual(l0.summary, "Initial commit");

  // Line 1 (finalLine 1, reused sha without repeated headers)
  const l1 = multiResult.get(1);
  assert.ok(l1);
  assert.strictEqual(l1.sha, "9b595a4235b06f7ee62071b568e833672ec06295");
  assert.strictEqual(l1.author, "Wahyu Ridiansyah");
  assert.strictEqual(l1.summary, "Initial commit");

  // Line 2 (uncommitted)
  const l2 = multiResult.get(2);
  assert.ok(l2);
  assert.strictEqual(l2.isUncommitted, true);
  assert.strictEqual(l2.author, "You");
  assert.strictEqual(l2.summary, "Uncommitted changes");
});

test("GitService - hasCachedBlame and clearCache with Windows path", () => {
  const gitService = new GitService();
  const windowsPath = "C:\\Users\\User\\Project\\src\\index.ts";
  assert.strictEqual(
    gitService.hasCachedBlame(windowsPath, 1, 10),
    false,
  );
  gitService.clearCache(windowsPath);
});

test("GitService - parsePorcelain with SHA-256 (64 hex characters)", () => {
  const gitService = new GitService();
  const sha256Output = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 1 1 1
author Satoshi Nakamoto
author-mail <satoshi@bitcoin.org>
author-time 1231006505
author-tz +0000
committer Satoshi Nakamoto
committer-mail <satoshi@bitcoin.org>
committer-time 1231006505
committer-tz +0000
summary The Times 03/Jan/2009 Chancellor on brink of second bailout for banks
filename genesis.txt
\tThe Times 03/Jan/2009 Chancellor on brink of second bailout for banks`;

  const result = gitService.parsePorcelain(sha256Output, "/repo");
  assert.strictEqual(result.size, 1);
  const blame0 = result.get(0);
  assert.ok(blame0);
  assert.strictEqual(blame0.sha, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.strictEqual(blame0.shortSha, "e3b0c44");
  assert.strictEqual(blame0.author, "Satoshi Nakamoto");
});

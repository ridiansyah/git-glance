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

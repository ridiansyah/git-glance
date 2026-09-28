import * as vscode from "vscode";
import { BlameInfo, GitGlanceConfig } from "./types";
import { formatRelativeTime, formatCustomDate } from "./utils/date";
import { formatInlineText, escapeMarkdown } from "./utils/format";

export class DecorationManager {
  private avatarDecorationType: vscode.TextEditorDecorationType | undefined;
  private textDecorationType: vscode.TextEditorDecorationType | undefined;

  public recreateDecorationType() {
    this.dispose();
  }

  public dispose() {
    if (this.avatarDecorationType) {
      this.avatarDecorationType.dispose();
      this.avatarDecorationType = undefined;
    }
    if (this.textDecorationType) {
      this.textDecorationType.dispose();
      this.textDecorationType = undefined;
    }
  }

  /**
   * Applies the inline blame decoration to the editor at the specified line.
   */
  public applyDecoration(
    editor: vscode.TextEditor,
    blame: BlameInfo,
    config: GitGlanceConfig,
    avatarUri?: vscode.Uri | null,
  ) {
    // 1. Dispose old decoration types before creating fresh ones
    this.dispose();

    if (blame.line < 0 || blame.line >= editor.document.lineCount) {
      return;
    }

    const line = editor.document.lineAt(blame.line);
    const range = new vscode.Range(line.range.end, line.range.end);
    const inlineText = this.formatInlineText(blame, config);

    const isPresetWithAvatar =
      config.preset === "default" ||
      config.preset === "github" ||
      config.preset === "custom";

    const hasAvatar = Boolean(
      config.showAvatar &&
      avatarUri &&
      isPresetWithAvatar &&
      !blame.isUncommitted,
    );

    const hoverMessage = config.showHover
      ? this.buildHoverMessage(blame, config.hoverDateFormat)
      : undefined;

    // 2. Dual-decoration architecture:
    // Both avatar and text decorations are attached using `after:` on line.range.end
    // with `DecorationRangeBehavior.ClosedClosed`.
    // Because both are in `after:`, the caret at line.range.end sits strictly BEFORE
    // both decorations (at the end of the code), completely eliminating the cursor glitch
    // where clicking code or pressing End caused the cursor to jump to the right of the avatar!

    if (hasAvatar && avatarUri) {
      this.avatarDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentIconPath: avatarUri,
          width: "14px",
          height: "14px",
          margin: "0 6px 0 3em",
          textDecoration: "none; vertical-align: middle",
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });

      const avatarOptions: vscode.DecorationOptions = {
        range,
      };
      editor.setDecorations(this.avatarDecorationType, [avatarOptions]);
    }

    this.textDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: inlineText,
        margin: hasAvatar ? "0" : "0 0 0 3em",
        color: new vscode.ThemeColor("gitGlance.inlineColor"),
        fontStyle: "normal",
        textDecoration: "none; vertical-align: middle",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    const textOptions: vscode.DecorationOptions = {
      range,
      hoverMessage,
    };

    editor.setDecorations(this.textDecorationType, [textOptions]);
  }

  /**
   * Clears all decorations from the editor.
   */
  public clear(editor: vscode.TextEditor) {
    if (this.avatarDecorationType) {
      editor.setDecorations(this.avatarDecorationType, []);
      this.avatarDecorationType.dispose();
      this.avatarDecorationType = undefined;
    }
    if (this.textDecorationType) {
      editor.setDecorations(this.textDecorationType, []);
      this.textDecorationType.dispose();
      this.textDecorationType = undefined;
    }
  }

  /**
   * Formats the inline blame string according to user config.
   */
  public formatInlineText(blame: BlameInfo, config: GitGlanceConfig): string {
    return formatInlineText(blame, config);
  }

  /**
   * Builds a modern, clean, fun Markdown hover tooltip.
   */
  public buildHoverMessage(
    blame: BlameInfo,
    hoverDateFormat: string = "DD/MM/YYYY HH:mm",
  ): vscode.MarkdownString | undefined {
    if (blame.isUncommitted) {
      return undefined;
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.supportThemeIcons = true;
    md.isTrusted = true;
    md.supportHtml = true;

    const timeAgo = formatRelativeTime(blame.authorDate);
    const exactDate = formatCustomDate(blame.authorDate, hoverDateFormat);

    const authorDisplay =
      blame.isCurrentUser && blame.author.toLowerCase() !== "you"
        ? `You (${escapeMarkdown(blame.author)})`
        : escapeMarkdown(blame.author);

    md.appendMarkdown(`### Git Glance\n\n`);
    md.appendMarkdown(
      `$(account) **Author:** ${authorDisplay} ${blame.authorEmail ? `*<${escapeMarkdown(blame.authorEmail)}>*` : ""}\n\n`,
    );
    md.appendMarkdown(`$(calendar) **Date:** ${timeAgo} (${exactDate})\n\n`);
    md.appendMarkdown(`$(git-commit) **Commit:** \`${blame.shortSha}\`\n\n`);

    md.appendMarkdown(`> **${escapeMarkdown(blame.summary)}**\n\n`);

    // Action buttons in Markdown
    const shaArg = encodeURIComponent(JSON.stringify([blame.sha]));
    const actions: string[] = [
      `[$(copy) Copy Hash](command:gitGlance.copyHash?${shaArg} "Copy full commit hash")`,
      `[$(info) Details](command:gitGlance.showCommitDetails?${shaArg} "View full commit message")`,
    ];

    if (blame.remoteCommitUrl) {
      actions.push(
        `[$(link-external) Open in Browser](${blame.remoteCommitUrl} "Open on GitHub / GitLab")`,
      );
    }

    md.appendMarkdown(`---\n\n${actions.join("  &nbsp;•&nbsp;  ")}`);

    return md;
  }
}

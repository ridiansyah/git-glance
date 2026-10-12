import * as vscode from "vscode";
import { GlanceController } from "./glance-controller";
import { GitService } from "./git";
import { BlameInfo } from "./types";

interface DetailsItem extends vscode.QuickPickItem {
  action?: "copyHash" | "copyMessage" | "openWeb";
}

async function resolveRepoRoot(
  blame: BlameInfo | null,
  gitService: GitService,
): Promise<string | null> {
  if (blame !== null && blame.repoRoot !== undefined) {
    return blame.repoRoot;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.document.uri.scheme !== "file") {
    return null;
  }
  return gitService.getRepoRoot(editor.document.uri.fsPath);
}

export function registerCommands(
  context: vscode.ExtensionContext,
  controller: GlanceController,
  gitService: GitService,
) {
  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("gitGlance.toggle", () => {
      controller.toggle();
    }),
  );

  // Toggle Avatar command
  context.subscriptions.push(
    vscode.commands.registerCommand("gitGlance.toggleAvatar", () => {
      controller.toggleAvatar();
    }),
  );

  // Copy Hash command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitGlance.copyHash",
      async (args?: string | string[]) => {
        let sha =
          typeof args === "string"
            ? args
            : Array.isArray(args)
              ? args[0]
              : undefined;

        if (!sha) {
          const blame = controller.getCurrentBlame();
          if (blame && !blame.isUncommitted) {
            sha = blame.sha;
          }
        }

        if (!sha || sha.replace(/0/g, "").length === 0) {
          vscode.window.showWarningMessage(
            "Git Glance: Line is not committed yet.",
          );
          return;
        }

        await vscode.env.clipboard.writeText(sha);
        vscode.window.showInformationMessage(
          `📋 Copied commit hash: ${sha.substring(0, 7)}`,
        );
      },
    ),
  );

  // Show Commit Details command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitGlance.showCommitDetails",
      async (args?: string | string[]) => {
        let sha =
          typeof args === "string"
            ? args
            : Array.isArray(args)
              ? args[0]
              : undefined;
        let blame = controller.getCurrentBlame();

        if (!sha && blame) {
          sha = blame.sha;
        }

        if (!sha) {
          vscode.window.showInformationMessage(
            "Git Glance: No commit information available.",
          );
          return;
        }

        if (blame && blame.isUncommitted && sha === blame.sha) {
          vscode.window.showInformationMessage(
            "✨ This line contains uncommitted changes.",
          );
          return;
        }

        const repoRoot = await resolveRepoRoot(blame, gitService);
        if (!repoRoot) {
          vscode.window.showWarningMessage("Git Glance: Not in a git repository.");
          return;
        }

        const meta = await gitService.getCommitMetadata(repoRoot, sha);
        if (!meta) {
          vscode.window.showWarningMessage(
            `Git Glance: Commit ${sha.substring(0, 7)} not found.`,
          );
          return;
        }

        const currentUserEmail = await gitService.getCurrentUserEmail(repoRoot);
        const isCurrentUser = gitService.isCurrentUser(
          meta.authorEmail,
          currentUserEmail,
        );
        const remoteCommitUrl = await gitService.getRemoteCommitUrl(repoRoot, sha);
        const shortSha = sha.substring(0, 7);
        const { summary, fullMessage } = meta;

        const body = fullMessage.slice(summary.length).trim();
        const authorName =
          isCurrentUser && meta.author.toLowerCase() !== "you"
            ? `You (${meta.author})`
            : meta.author;
        const authorLine = `Author: ${authorName} • ${meta.authorDate.toLocaleString()}`;

        // QuickPick renders `detail` on one line, so the body is joined with " · ".
        const bodyOneLine = body
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join(" · ");

        const items: DetailsItem[] = [
          {
            label: `$(git-commit) Commit: ${shortSha}`,
            description: summary,
            detail: bodyOneLine.length > 0 ? `${authorLine} — ${bodyOneLine}` : authorLine,
          },
          {
            label: "$(clippy) Copy Commit Hash",
            description: sha,
            action: "copyHash",
          },
          {
            label: "$(copy) Copy Commit Message",
            description: summary,
            action: "copyMessage",
          },
        ];

        if (remoteCommitUrl !== null) {
          items.push({
            label: "$(globe) Open on Web",
            description: remoteCommitUrl,
            action: "openWeb",
          });
        }

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Commit ${shortSha}: ${summary}`,
        });

        if (!selected) {
          return;
        }

        if (selected.action === "copyHash") {
          await vscode.env.clipboard.writeText(sha);
          vscode.window.showInformationMessage(
            `📋 Copied commit hash: ${shortSha}`,
          );
        } else if (selected.action === "copyMessage") {
          await vscode.env.clipboard.writeText(fullMessage);
          vscode.window.showInformationMessage("📋 Copied commit message.");
        } else if (selected.action === "openWeb" && remoteCommitUrl !== null) {
          vscode.env.openExternal(vscode.Uri.parse(remoteCommitUrl));
        }
      },
    ),
  );

  // Open on Remote command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitGlance.openOnRemote",
      async (args?: string | string[]) => {
        let sha =
          typeof args === "string"
            ? args
            : Array.isArray(args)
              ? args[0]
              : undefined;
        const blame = controller.getCurrentBlame();

        if (!sha && blame) {
          sha = blame.sha;
        }

        if (!sha) {
          vscode.window.showWarningMessage("Git Glance: No commit found.");
          return;
        }

        if (sha.replace(/0/g, "").length === 0) {
          vscode.window.showInformationMessage(
            "Git Glance: Line contains uncommitted changes.",
          );
          return;
        }

        const repoRoot = await resolveRepoRoot(blame, gitService);
        if (!repoRoot) {
          vscode.window.showWarningMessage(
            "Git Glance: Not in a git repository.",
          );
          return;
        }

        const remoteUrl = await gitService.getRemoteCommitUrl(repoRoot, sha);
        if (!remoteUrl) {
          vscode.window.showWarningMessage(
            "Git Glance: Remote repository URL not found or unsupported.",
          );
          return;
        }

        vscode.env.openExternal(vscode.Uri.parse(remoteUrl));
      },
    ),
  );
}

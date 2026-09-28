import * as vscode from "vscode";
import { GlanceController } from "./glance-controller";
import { GitService } from "./git";

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

        if (!sha || !blame) {
          vscode.window.showInformationMessage(
            "Git Glance: No commit information for current line.",
          );
          return;
        }

        if (blame.isUncommitted) {
          vscode.window.showInformationMessage(
            "✨ This line contains uncommitted changes.",
          );
          return;
        }

        const repoRoot = blame.repoRoot;
        let details = blame.summary;

        if (repoRoot) {
          const fullMessage = await gitService.getCommitDetails(repoRoot, sha);
          if (fullMessage) {
            details = fullMessage;
          }
        }

        const items: vscode.QuickPickItem[] = [
          {
            label: `$(git-commit) Commit: ${blame.shortSha}`,
            description: blame.summary,
            detail: `Author: ${blame.author} • ${blame.authorDate.toLocaleString()}`,
          },
          {
            label: "$(clippy) Copy Commit Hash",
            description: sha,
          },
          {
            label: "$(copy) Copy Commit Message",
            description: blame.summary,
          },
        ];

        if (blame.remoteCommitUrl) {
          items.push({
            label: "$(globe) Open on Web",
            description: blame.remoteCommitUrl,
          });
        }

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Commit ${blame.shortSha}: ${blame.summary}`,
        });

        if (!selected) {
          return;
        }

        if (selected.label.includes("Copy Commit Hash")) {
          await vscode.env.clipboard.writeText(sha);
          vscode.window.showInformationMessage(
            `📋 Copied commit hash: ${sha.substring(0, 7)}`,
          );
        } else if (selected.label.includes("Copy Commit Message")) {
          await vscode.env.clipboard.writeText(details);
          vscode.window.showInformationMessage("📋 Copied commit message.");
        } else if (
          selected.label.includes("Open on Web") &&
          blame.remoteCommitUrl
        ) {
          vscode.env.openExternal(vscode.Uri.parse(blame.remoteCommitUrl));
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

        if (!blame || !sha) {
          vscode.window.showWarningMessage("Git Glance: No commit found.");
          return;
        }

        if (blame.isUncommitted || sha.replace(/0/g, "").length === 0) {
          vscode.window.showInformationMessage(
            "Git Glance: Line contains uncommitted changes.",
          );
          return;
        }

        if (!blame.repoRoot) {
          vscode.window.showWarningMessage(
            "Git Glance: Not in a git repository.",
          );
          return;
        }

        const remoteUrl = await gitService.getRemoteCommitUrl(
          blame.repoRoot,
          sha,
        );
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

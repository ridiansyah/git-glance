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

        const editor = vscode.window.activeTextEditor;
        const filePath = editor?.document.uri.fsPath;
        const repoRoot =
          blame?.repoRoot ?? (filePath ? await gitService.getRepoRoot(filePath) : null);

        if (!repoRoot) {
          vscode.window.showWarningMessage("Git Glance: Not in a git repository.");
          return;
        }

        let authorName = blame?.author ?? "Unknown";
        let authorEmail = blame?.authorEmail ?? "";
        let authorDate = blame?.authorDate ?? new Date();
        let summary = blame?.summary ?? "";
        let details = summary;
        let isCurrentUser = blame?.isCurrentUser ?? false;
        let shortSha = sha.substring(0, 7);
        let remoteCommitUrl = blame?.remoteCommitUrl;

        // If sha was explicitly provided from hover link and differs from active cursor line blame
        if (!blame || blame.sha !== sha) {
          const meta = await gitService.getCommitMetadata(repoRoot, sha);
          if (meta) {
            authorName = meta.author;
            authorEmail = meta.authorEmail;
            authorDate = meta.authorDate;
            summary = meta.summary;
            details = meta.fullMessage;
            const currentUserEmail = await gitService.getCurrentUserEmail(repoRoot);
            isCurrentUser = gitService.isCurrentUser(authorEmail, currentUserEmail);
          }
          remoteCommitUrl = (await gitService.getRemoteCommitUrl(repoRoot, sha)) ?? undefined;
        } else {
          const fullMessage = await gitService.getCommitDetails(repoRoot, sha);
          if (fullMessage) {
            details = fullMessage;
          }
        }

        const hasExtendedBody = details && details.trim() !== summary.trim();
        const authorLine = `Author: ${isCurrentUser && authorName.toLowerCase() !== "you" ? `You (${authorName})` : authorName} • ${authorDate.toLocaleString()}`;

        const items: vscode.QuickPickItem[] = [
          {
            label: `$(git-commit) Commit: ${shortSha}`,
            description: summary,
            detail: hasExtendedBody ? `${authorLine}\n\n${details}` : authorLine,
          },
          {
            label: "$(clippy) Copy Commit Hash",
            description: sha,
          },
          {
            label: "$(copy) Copy Commit Message",
            description: summary,
            detail: hasExtendedBody ? details : undefined,
          },
        ];

        if (remoteCommitUrl) {
          items.push({
            label: "$(globe) Open on Web",
            description: remoteCommitUrl,
          });
        }

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Commit ${shortSha}: ${summary}`,
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
          remoteCommitUrl
        ) {
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

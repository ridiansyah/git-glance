import * as vscode from "vscode";
import { GitService } from "./git";
import { DecorationManager } from "./decoration";
import { GlanceController } from "./glance-controller";
import { registerCommands } from "./commands";
import { AvatarService } from "./utils/avatar";

let controller: GlanceController | undefined;
let decorationManager: DecorationManager | undefined;
let gitService: GitService | undefined;
let avatarService: AvatarService | undefined;

export function activate(context: vscode.ExtensionContext) {
  gitService = new GitService();
  decorationManager = new DecorationManager();
  avatarService = new AvatarService(context.globalStorageUri?.fsPath);
  controller = new GlanceController(
    gitService,
    decorationManager,
    avatarService,
  );

  // Register commands
  registerCommands(context, controller, gitService);

  // Register event listeners
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      controller?.onActiveEditorChange(editor);
    }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      controller?.onSelectionChange(event);
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      controller?.onDocumentChange(event);
    }),

    vscode.workspace.onDidSaveTextDocument((document) => {
      controller?.onDocumentSave(document);
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      controller?.onDocumentClose(document);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitGlance")) {
        controller?.reloadConfig();
      }
    }),

    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused && vscode.window.activeTextEditor) {
        controller?.updateBlame(vscode.window.activeTextEditor, true);
      }
    }),

    {
      dispose: () => {
        controller?.dispose();
        decorationManager?.dispose();
        avatarService?.dispose();
        gitService?.dispose();
      },
    },
  );

  // Hook into VS Code built-in Git extension if present to detect external commits
  try {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (gitExtension) {
      const activateGit = async () => {
        try {
          const gitApi = gitExtension.exports?.getAPI?.(2);
          if (gitApi) {
            gitApi.repositories?.forEach((repo: any) => {
              repo.state?.onDidChange?.(() => {
                gitService?.clearCache();
                if (vscode.window.activeTextEditor) {
                  controller?.updateBlame(vscode.window.activeTextEditor, true);
                }
              });
            });
            gitApi.onDidOpenRepository?.((repo: any) => {
              repo.state?.onDidChange?.(() => {
                gitService?.clearCache();
                if (vscode.window.activeTextEditor) {
                  controller?.updateBlame(vscode.window.activeTextEditor, true);
                }
              });
            });
          }
        } catch {
          // Ignore if git extension API is unavailable
        }
      };
      if (gitExtension.isActive) {
        activateGit();
      } else {
        gitExtension.activate().then(activateGit, () => {});
      }
    }
  } catch {
    // Ignore error hook
  }

  // Run immediately on active editor if any
  if (vscode.window.activeTextEditor) {
    controller.onActiveEditorChange(vscode.window.activeTextEditor);
  }
}

export function deactivate() {
  controller?.dispose();
  decorationManager?.dispose();
  avatarService?.dispose();
  gitService?.dispose();
}

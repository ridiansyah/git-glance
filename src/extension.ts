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

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitGlance")) {
        controller?.reloadConfig();
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

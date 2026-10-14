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
let logChannel: vscode.LogOutputChannel | undefined;

function getLogChannel(): vscode.LogOutputChannel {
  if (logChannel === undefined) {
    logChannel = vscode.window.createOutputChannel("Git Glance", { log: true });
  }
  return logChannel;
}

export function activate(context: vscode.ExtensionContext) {
  gitService = new GitService(
    {},
    {
      info: (message) => getLogChannel().info(message),
      warn: (message) => getLogChannel().warn(message),
    },
  );
  gitService.onGitMissing = () => {
    vscode.window
      .showWarningMessage(
        "Git Glance: git was not found. Install git or set 'git.path' in settings.",
        "Open Settings",
        "Show Log",
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "git.path",
          );
        } else if (choice === "Show Log") {
          getLogChannel().show(true);
        }
      });
  };
  decorationManager = new DecorationManager();
  avatarService = new AvatarService(context.globalStorageUri?.fsPath);
  controller = new GlanceController(
    gitService,
    decorationManager,
    avatarService,
  );

  // Register commands
  registerCommands(context, controller, gitService, () =>
    getLogChannel().show(true),
  );

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
        logChannel?.dispose();
      },
    },
  );

  watchExternalCommits(context);

  // Run immediately on active editor if any
  if (vscode.window.activeTextEditor) {
    controller.onActiveEditorChange(vscode.window.activeTextEditor);
  }
}

// Subset of the vscode.git extension API (v1) used here.
interface GitApiRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { commit?: string };
    onDidChange: vscode.Event<void>;
  };
}

interface GitApi {
  repositories: GitApiRepository[];
  onDidOpenRepository: vscode.Event<GitApiRepository>;
  /** The git executable VS Code resolved (`git.path`, registry, known install folders). */
  git?: { path?: string };
}

/**
 * Clears a repository's blame cache when its HEAD commit changes (commit, amend,
 * checkout, reset from the terminal or the SCM view).
 *
 * `repo.state.onDidChange` also fires on every status refresh (saves, window focus,
 * any working tree change), so reacting to every event would empty the cache constantly.
 */
function watchExternalCommits(context: vscode.ExtensionContext) {
  const gitExtension = vscode.extensions.getExtension("vscode.git");
  if (!gitExtension) {
    return;
  }

  const watchRepository = (repo: GitApiRepository) => {
    let head = repo.state.HEAD?.commit;
    context.subscriptions.push(
      repo.state.onDidChange(() => {
        const nextHead = repo.state.HEAD?.commit;
        if (nextHead === head) {
          return;
        }
        head = nextHead;
        gitService?.clearRepoCache(repo.rootUri.fsPath);
        controller?.refreshActiveEditor();
      }),
    );
  };

  const attach = () => {
    try {
      const gitApi: GitApi | undefined = gitExtension.exports?.getAPI?.(1);
      if (!gitApi) {
        return;
      }
      // A bare `git` only works when it is on PATH; VS Code's own lookup also finds
      // installs that aren't (common on Windows).
      const gitPath = gitApi.git?.path;
      if (typeof gitPath === "string" && gitPath.length > 0) {
        gitService?.setGitPath(gitPath);
        controller?.refreshActiveEditor();
      }
      gitApi.repositories.forEach(watchRepository);
      context.subscriptions.push(
        gitApi.onDidOpenRepository((repo) => {
          watchRepository(repo);
          // A folder that just became a repository was cached as "not a repository".
          gitService?.resetRepoDiscovery();
          controller?.refreshActiveEditor();
        }),
      );
    } catch {
      // Git extension API unavailable (e.g. git.enabled = false)
    }
  };

  if (gitExtension.isActive) {
    attach();
  } else {
    gitExtension.activate().then(attach, () => {});
  }
}

export function deactivate() {
  controller?.dispose();
  decorationManager?.dispose();
  avatarService?.dispose();
  gitService?.dispose();
}

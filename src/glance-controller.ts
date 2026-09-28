import * as vscode from "vscode";
import { GitService } from "./git";
import { DecorationManager } from "./decoration";
import { AvatarService } from "./utils/avatar";
import { BlameInfo, GitGlanceConfig, GlancePreset } from "./types";

export class GlanceController {
  private config: GitGlanceConfig;
  private debounceTimer: NodeJS.Timeout | undefined;
  private currentBlame: BlameInfo | null = null;
  private currentLine: number = -1;
  private avatarDisposable?: { dispose: () => void };

  constructor(
    private gitService: GitService,
    private decorationManager: DecorationManager,
    private avatarService?: AvatarService,
  ) {
    this.config = this.loadConfig();

    if (this.avatarService) {
      this.avatarDisposable = this.avatarService.onAvatarReady((key) => {
        if (this.currentBlame && vscode.window.activeTextEditor) {
          const activeKey = this.avatarService!.getAvatarKey(
            this.currentBlame.author,
            this.currentBlame.authorEmail,
            this.currentBlame.isUncommitted,
          );
          if (activeKey === key) {
            this.updateBlame(vscode.window.activeTextEditor, true);
          }
        }
      });
    }
  }

  public getConfig(): GitGlanceConfig {
    return this.config;
  }

  public getCurrentBlame(): BlameInfo | null {
    return this.currentBlame;
  }

  public reloadConfig() {
    this.config = this.loadConfig();
    this.decorationManager.recreateDecorationType();
    this.updateBlame(vscode.window.activeTextEditor, true);
  }

  public toggle() {
    const wsConfig = vscode.workspace.getConfiguration("gitGlance");
    const newEnabled = !this.config.enabled;
    wsConfig.update("enabled", newEnabled, vscode.ConfigurationTarget.Global);
    this.config.enabled = newEnabled;

    if (!newEnabled) {
      if (vscode.window.activeTextEditor) {
        this.decorationManager.clear(vscode.window.activeTextEditor);
      }
      vscode.window.showInformationMessage("Git Glance: Disabled");
    } else {
      vscode.window.showInformationMessage("Git Glance: Enabled");
      this.updateBlame(vscode.window.activeTextEditor, true);
    }
  }

  public toggleAvatar() {
    const wsConfig = vscode.workspace.getConfiguration("gitGlance");
    const newShowAvatar = !this.config.showAvatar;
    wsConfig.update(
      "showAvatar",
      newShowAvatar,
      vscode.ConfigurationTarget.Global,
    );
    this.config.showAvatar = newShowAvatar;

    vscode.window.showInformationMessage(
      `Git Glance: Avatar ${newShowAvatar ? "Enabled" : "Disabled"}`,
    );
    this.updateBlame(vscode.window.activeTextEditor, true);
  }

  public onSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    const editor = event.textEditor;
    if (!this.config.enabled || !editor) {
      return;
    }

    const selection = editor.selection;
    // Don't update if selection spans multiple lines
    if (!selection.isSingleLine) {
      this.clear(editor);
      return;
    }

    const line = selection.active.line;
    if (line === this.currentLine && this.currentBlame) {
      // Cursor moved horizontally on the same line, no need to re-fetch
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.updateBlame(editor);
    }, this.config.delay);
  }

  public onActiveEditorChange(editor: vscode.TextEditor | undefined) {
    this.currentLine = -1;
    this.currentBlame = null;
    if (!editor || !this.config.enabled) {
      return;
    }
    this.updateBlame(editor, true);
  }

  public onDocumentSave(document: vscode.TextDocument) {
    this.gitService.clearCache(document.fileName);
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document === document) {
      this.updateBlame(activeEditor, true);
    }
  }

  public onDocumentChange(event: vscode.TextDocumentChangeEvent) {
    if (!this.config.enabled || event.contentChanges.length === 0) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== event.document) {
      return;
    }

    const activeLine = editor.selection.active.line;
    const affectsActiveLine = event.contentChanges.some((change) => {
      return (
        change.range.start.line <= activeLine &&
        change.range.end.line >= activeLine
      );
    });

    if (affectsActiveLine) {
      this.currentBlame = null;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.updateBlame(editor, true);
      }, this.config.delay);
    }
  }

  public async updateBlame(
    editor: vscode.TextEditor | undefined,
    force: boolean = false,
  ) {
    if (!editor || !this.config.enabled) {
      if (editor) {
        this.decorationManager.clear(editor);
      }
      return;
    }

    const document = editor.document;
    if (document.isUntitled || document.uri.scheme !== "file") {
      this.clear(editor);
      return;
    }

    const line = editor.selection.active.line;
    if (!force && line === this.currentLine && this.currentBlame) {
      return;
    }

    this.currentLine = line;

    const blame = await this.gitService.getBlameForLine(
      document.fileName,
      line,
      document.version,
      document.getText(),
      document.isDirty,
    );

    // Verify editor & line haven't changed while waiting for async blame
    if (
      vscode.window.activeTextEditor !== editor ||
      editor.selection.active.line !== line
    ) {
      return;
    }

    if (!blame) {
      this.clear(editor);
      return;
    }

    this.currentBlame = blame;
    let avatarUri: vscode.Uri | null = null;
    if (this.config.showAvatar && this.avatarService) {
      const avatarPath = this.avatarService.getAvatarPath(
        blame.author,
        blame.authorEmail,
        blame.isUncommitted,
        blame.remoteCommitUrl,
      );
      if (avatarPath) {
        avatarUri = vscode.Uri.file(avatarPath);
      }
    }

    this.decorationManager.applyDecoration(
      editor,
      blame,
      this.config,
      avatarUri,
    );
  }

  public clear(editor: vscode.TextEditor) {
    this.currentLine = -1;
    this.currentBlame = null;
    this.decorationManager.clear(editor);
  }

  public dispose() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.avatarDisposable) {
      this.avatarDisposable.dispose();
    }
  }

  private loadConfig(): GitGlanceConfig {
    const wsConfig = vscode.workspace.getConfiguration("gitGlance");
    return {
      enabled: wsConfig.get<boolean>("enabled", true),
      preset: wsConfig.get<GlancePreset>("preset", "default"),
      showAvatar: wsConfig.get<boolean>("showAvatar", true),
      prefix: wsConfig.get<string>("prefix", "👀 "),
      format: wsConfig.get<string>(
        "format",
        "${author} committed ${time}: ${message}",
      ),
      uncommittedFormat: wsConfig.get<string>(
        "uncommittedFormat",
        "You: uncommitted changes",
      ),
      dateStyle: wsConfig.get<"relative" | "absolute" | "short">(
        "dateStyle",
        "relative",
      ),
      hoverDateFormat: wsConfig.get<string>(
        "hoverDateFormat",
        "DD/MM/YYYY HH:mm",
      ),
      delay: wsConfig.get<number>("delay", 100),
      showHover: wsConfig.get<boolean>("showHover", true),
    };
  }
}

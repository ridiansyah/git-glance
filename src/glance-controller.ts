import * as vscode from "vscode";
import { GitService, createUncommittedBlame } from "./git";
import { DecorationManager } from "./decoration";
import { AvatarService } from "./utils/avatar";
import {
  AvatarSource,
  BlameInfo,
  DateStyle,
  GitGlanceConfig,
  GlancePreset,
} from "./types";

export class GlanceController {
  private config: GitGlanceConfig;
  private debounceTimer: NodeJS.Timeout | undefined;
  private activeAbortController: AbortController | undefined;
  private currentBlame: BlameInfo | null = null;
  private currentLine: number = -1;
  private lastEditor?: vscode.TextEditor;
  private avatarDisposable?: { dispose: () => void };

  constructor(
    private gitService: GitService,
    private decorationManager: DecorationManager,
    private avatarService?: AvatarService,
  ) {
    this.config = this.loadConfig();
    this.gitService.setOptions({
      remoteName: this.config.remote,
      useIgnoreRevsFile: this.config.useIgnoreRevsFile,
    });

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
    this.gitService.setOptions({
      remoteName: this.config.remote,
      useIgnoreRevsFile: this.config.useIgnoreRevsFile,
    });
    this.updateBlame(vscode.window.activeTextEditor, true);
  }

  /**
   * Re-renders the active editor after the cache of the given repository (or all) was cleared.
   */
  public refreshActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.updateBlame(editor, true);
    }
  }

  // Both toggles only write the setting; onDidChangeConfiguration → reloadConfig re-renders.
  public async toggle() {
    const newEnabled = !this.config.enabled;
    await this.updateSetting("enabled", newEnabled);
    vscode.window.showInformationMessage(
      `Git Glance: ${newEnabled ? "Enabled" : "Disabled"}`,
    );
  }

  public async toggleAvatar() {
    const newShowAvatar = !this.config.showAvatar;
    await this.updateSetting("showAvatar", newShowAvatar);
    vscode.window.showInformationMessage(
      `Git Glance: Avatar ${newShowAvatar ? "Enabled" : "Disabled"}`,
    );
  }

  /**
   * Writes the setting at the most specific scope that already defines it.
   */
  private async updateSetting(key: "enabled" | "showAvatar", value: boolean) {
    const wsConfig = vscode.workspace.getConfiguration("gitGlance");
    const inspected = wsConfig.inspect<boolean>(key);
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
    await wsConfig.update(key, value, target);
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
      this.debounceTimer = undefined;
    }

    // Zero-debounce instant render if line blame is already cached in memory
    const document = editor.document;
    if (
      !document.isUntitled &&
      document.uri.scheme === "file" &&
      this.gitService.hasCachedBlame(document.fileName, document.version, line)
    ) {
      this.updateBlame(editor);
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.updateBlame(editor);
    }, this.config.delay);
  }

  public onActiveEditorChange(editor: vscode.TextEditor | undefined) {
    if (this.lastEditor && this.lastEditor !== editor) {
      this.decorationManager.clear(this.lastEditor);
    }
    this.lastEditor = editor;
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

  public onDocumentClose(document: vscode.TextDocument) {
    if (this.lastEditor && this.lastEditor.document === document) {
      this.lastEditor = undefined;
    }
    this.gitService.clearCache(document.fileName);
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

    if (!affectsActiveLine) {
      return;
    }

    this.gitService.clearCache(event.document.fileName);
    this.cancelPending();

    // A line being typed on is uncommitted, so render that without spawning git.
    // Only when the line already had a blame: that proves the file is tracked.
    // An edit that makes the buffer clean again (undo to saved) still asks git.
    const previous = this.currentBlame;
    if (
      previous !== null &&
      this.currentLine === activeLine &&
      event.document.isDirty
    ) {
      const blame = createUncommittedBlame(activeLine, previous.repoRoot);
      this.currentBlame = blame;
      this.decorationManager.applyDecoration(editor, blame, this.config, null);
      return;
    }

    this.currentBlame = null;
    this.debounceTimer = setTimeout(() => {
      this.updateBlame(editor, true);
    }, Math.max(this.config.delay, 300));
  }

  public async updateBlame(
    editor: vscode.TextEditor | undefined,
    force: boolean = false,
  ) {
    if (!editor || !this.config.enabled || !vscode.workspace.isTrusted) {
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

    // Abort previous in-flight git process
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const blame = await this.gitService.getBlameForLine(
      {
        filePath: document.fileName,
        line,
        documentVersion: document.version,
        lineCount: document.lineCount,
        isDirty: document.isDirty,
        getText: () => document.getText(),
      },
      abortController.signal,
    );

    if (this.activeAbortController === abortController) {
      this.activeAbortController = undefined;
    }

    if (abortController.signal.aborted) {
      return;
    }

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
    if (this.config.showAvatar && this.avatarService && !blame.isUncommitted) {
      const avatarPath = this.avatarService.getAvatarPath(
        blame.author,
        blame.authorEmail,
        blame.isUncommitted,
        this.config.avatarSource === "remote",
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

  private cancelPending() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  public dispose() {
    this.cancelPending();
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
      avatarSource: wsConfig.get<AvatarSource>("avatarSource", "remote"),
      prefix: wsConfig.get<string>("prefix", "👀 "),
      format: wsConfig.get<string>("format", "${author}, ${time}: ${message}"),
      uncommittedFormat: wsConfig.get<string>(
        "uncommittedFormat",
        "${author}, ${time}: ${message}",
      ),
      dateStyle: wsConfig.get<DateStyle>("dateStyle", "relative"),
      hoverDateFormat: wsConfig.get<string>(
        "hoverDateFormat",
        "DD/MM/YYYY HH:mm",
      ),
      delay: wsConfig.get<number>("delay", 100),
      showHover: wsConfig.get<boolean>("showHover", true),
      maxMessageLength: wsConfig.get<number>("maxMessageLength", 60),
      remote: wsConfig.get<string>("remote", ""),
      useIgnoreRevsFile: wsConfig.get<boolean>("useIgnoreRevsFile", true),
    };
  }
}

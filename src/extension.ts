import * as vscode from "vscode";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  // 1. Copy Files selected in Explorer
  const copySelectedFiles = vscode.commands.registerCommand(
    "context-copier.copySelectedFiles",
    async (uri: vscode.Uri, files: vscode.Uri[]) => {
      // "files" contains all selected files (multi-select).
      // If "files" is undefined (single selection), we use "uri".
      // If triggered from Command Palette, both might be undefined, so we fallback to active editor.

      let targets = files;
      if (!targets && uri) {
        targets = [uri];
      }

      // Fallback: If triggered via command palette with no selection context
      if (!targets || targets.length === 0) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targets = [activeEditor.document.uri];
        }
      }

      if (targets && targets.length > 0) {
        await copyToClipboard(targets);
      } else {
        vscode.window.showInformationMessage(
          "No files selected via context menu."
        );
      }
    }
  );

  // 2. Copy Active Text Editor (Keyboard Shortcut)
  const copyCurrentFile = vscode.commands.registerTextEditorCommand(
    "context-copier.copyCurrentFile",
    async (editor) => {
      await copyToClipboard([editor.document.uri]);
    }
  );

  // 3. Copy Selected Tab (FIXED)
  const copySelectedTab = vscode.commands.registerCommand(
    "context-copier.copySelectedTab",
    async (arg: vscode.Uri | vscode.Tab | undefined) => {
      const uri = resolveUriFromArgument(arg);

      if (uri) {
        await copyToClipboard([uri]);
      } else {
        vscode.window.showWarningMessage(
          "Could not determine file path for this tab."
        );
      }
    }
  );

  // 4. Copy All Tabs
  const copyAllTabs = vscode.commands.registerCommand(
    "context-copier.copyAllTabs",
    async () => {
      const uris = getAllOpenTabUris();
      await copyToClipboard(uris);
    }
  );

  // 5. Aggregate Selected Tab (FIXED)
  const aggregateSelectedTab = vscode.commands.registerCommand(
    "context-copier.aggregateSelectedTab",
    async (arg: vscode.Uri | vscode.Tab | undefined) => {
      const uri = resolveUriFromArgument(arg);

      if (uri) {
        await aggregateToNewFile([uri]);
      } else {
        vscode.window.showWarningMessage(
          "Could not determine file path for this tab."
        );
      }
    }
  );

  // 6. Aggregate All Tabs
  const aggregateAllTabs = vscode.commands.registerCommand(
    "context-copier.aggregateAllTabs",
    async () => {
      const uris = getAllOpenTabUris();
      await aggregateToNewFile(uris);
    }
  );

  context.subscriptions.push(
    copySelectedFiles,
    copyCurrentFile,
    copySelectedTab,
    copyAllTabs,
    aggregateSelectedTab,
    aggregateAllTabs
  );
}

// --- Helper Functions ---

/**
 * Helper to resolve the URI whether the command was called via:
 * 1. Context menu (provides vscode.Uri)
 * 2. API/Other (might provide vscode.Tab)
 * 3. Command Palette (provides undefined -> use active tab)
 */
function resolveUriFromArgument(
  arg: vscode.Uri | vscode.Tab | undefined
): vscode.Uri | null {
  // 1. Context Menu provides a URI directly
  if (arg instanceof vscode.Uri) {
    return arg;
  }

  // 2. Sometimes it might be a Tab object
  if (arg && typeof arg === "object" && "input" in arg) {
    return getUriFromTab(arg as vscode.Tab);
  }

  // 3. If undefined (Command Palette), get the Active Tab
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab) {
    return getUriFromTab(activeTab);
  }

  return null;
}

/**
 * Safely extracts a URI from a Tab, handling Text, Diffs, and Notebooks.
 */
function getUriFromTab(tab: vscode.Tab): vscode.Uri | null {
  const input = tab.input;

  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  // Handle Git Diff views (return the 'modified' side, i.e., the current version)
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  // Fallback for Notebooks or other types that have a URI property
  if (input && typeof input === "object" && "uri" in input) {
    return (input as any).uri;
  }

  return null;
}

function getAllOpenTabUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      const uri = getUriFromTab(tab);
      if (uri) {
        uris.push(uri);
      }
    }
  }
  return uris;
}

async function getFileData(
  fileUri: vscode.Uri
): Promise<{ relativePath: string; content: string } | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : "";

  // Handle Untitled files (unsaved)
  if (fileUri.scheme === "untitled") {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString()
    );
    if (doc) {
      return {
        relativePath: path.basename(doc.uri.path),
        content: doc.getText(),
      };
    }
  }

  // Handle real files
  try {
    // We open the document via workspace to ensure we get the *current* content
    // in the editor (including dirty/unsaved changes) if it's open.
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString()
    );

    let content = "";
    if (openDoc) {
      content = openDoc.getText();
    } else {
      // If not open in an editor, read from disk
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      content = Buffer.from(contentBytes).toString("utf8");
    }

    let relativePath = workspacePath
      ? path.relative(workspacePath, fileUri.fsPath)
      : fileUri.fsPath;

    relativePath = relativePath.split(path.sep).join("/");

    return { relativePath, content };
  } catch (error) {
    console.error(`Error reading file: ${fileUri.toString()}`, error);
    return null;
  }
}

function formatFileAsMarkdown(fileData: {
  relativePath: string;
  content: string;
}): string {
  const content = fileData.content.endsWith("\n")
    ? fileData.content
    : `${fileData.content}\n`;
  const displayPath = `/${fileData.relativePath}`;

  return `---
\`${displayPath}\`

\`\`\`
${content}\`\`\`
---

`;
}

async function copyToClipboard(uris: vscode.Uri[]) {
  if (!uris || uris.length === 0) {
    vscode.window.showInformationMessage("No files found to copy.");
    return;
  }

  const cleanupComment = "<!-- Aggregated file contents -->";

  // Close existing aggregated file if open
  for (const editor of vscode.window.visibleTextEditors) {
    if (
      editor.document.isUntitled &&
      editor.document.getText().startsWith(cleanupComment)
    ) {
      await vscode.window.showTextDocument(editor.document, {
        preview: true,
        preserveFocus: false,
      });
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
    }
  }

  let combinedContent = "";
  let successCount = 0;

  // Deduplicate URIs
  const uniqueUris = Array.from(new Set(uris.map((u) => u.toString()))).map(
    (s) => vscode.Uri.parse(s)
  );

  for (const uri of uniqueUris) {
    const fileData = await getFileData(uri);
    if (fileData) {
      combinedContent += formatFileAsMarkdown(fileData);
      successCount++;
    }
  }

  if (combinedContent) {
    await vscode.env.clipboard.writeText(combinedContent.trim());
    vscode.window.showInformationMessage(
      `Copied content of ${successCount} file(s) to clipboard.`
    );
  } else {
    vscode.window.showWarningMessage(
      "Could not read content from selected files."
    );
  }
}

async function aggregateToNewFile(uris: vscode.Uri[]) {
  if (!uris || uris.length === 0) {
    vscode.window.showInformationMessage("No files found to copy.");
    return;
  }

  const cleanupComment = "<!-- Aggregated file contents -->";

  // Close existing aggregated file if open
  for (const editor of vscode.window.visibleTextEditors) {
    if (
      editor.document.isUntitled &&
      editor.document.getText().startsWith(cleanupComment)
    ) {
      await vscode.window.showTextDocument(editor.document, {
        preview: true,
        preserveFocus: false,
      });
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
    }
  }

  // Deduplicate URIs
  const uniqueUris = Array.from(new Set(uris.map((u) => u.toString()))).map(
    (s) => vscode.Uri.parse(s)
  );

  let aggregatedContent = "";
  for (const uri of uniqueUris) {
    const fileData = await getFileData(uri);
    if (fileData) {
      aggregatedContent += formatFileAsMarkdown(fileData);
    }
  }

  if (aggregatedContent) {
    const newDoc = await vscode.workspace.openTextDocument({
      content: `${cleanupComment}\n\n${aggregatedContent.trim()}`,
      language: "markdown",
    });
    await vscode.window.showTextDocument(newDoc);
  } else {
    vscode.window.showInformationMessage(
      "No readable text files found to aggregate."
    );
  }
}

export function deactivate() {}

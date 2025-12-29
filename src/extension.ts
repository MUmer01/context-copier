import * as vscode from "vscode";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  const copySelectedFiles = vscode.commands.registerCommand(
    "context-copier.copySelectedFiles",
    async (uri: vscode.Uri, files: vscode.Uri[]) => {
      await copyToClipboard(files || [uri]);
    }
  );

  const copyCurrentFile = vscode.commands.registerTextEditorCommand(
    "context-copier.copyCurrentFile",
    async (editor) => {
      await copyToClipboard([editor.document.uri]);
    }
  );

  const copySelectedTab = vscode.commands.registerCommand(
    "context-copier.copySelectedTab",
    async (tab: vscode.Tab | undefined) => {
      const targetTab = tab || vscode.window.tabGroups.activeTabGroup.activeTab;
      if (targetTab?.input instanceof vscode.TabInputText) {
        await copyToClipboard([targetTab.input.uri]);
      } else {
        vscode.window.showWarningMessage(
          "The selected tab is not a text file."
        );
      }
    }
  );

  const copyAllTabs = vscode.commands.registerCommand(
    "context-copier.copyAllTabs",
    async () => {
      const uris = getAllOpenTabUris();
      await copyToClipboard(uris);
    }
  );

  const aggregateSelectedTab = vscode.commands.registerCommand(
    "context-copier.aggregateSelectedTab",
    async (tab: vscode.Tab | undefined) => {
      const targetTab = tab || vscode.window.tabGroups.activeTabGroup.activeTab;
      if (targetTab) {
        await aggregateToNewFile([targetTab]);
      } else {
        vscode.window.showWarningMessage(
          "Could not identify the selected tab."
        );
      }
    }
  );

  const aggregateAllTabs = vscode.commands.registerCommand(
    "context-copier.aggregateAllTabs",
    async () => {
      const allTabs = vscode.window.tabGroups.all.flatMap(
        (group) => group.tabs
      );
      await aggregateToNewFile(allTabs);
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

function getAllOpenTabUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        uris.push(tab.input.uri);
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
  } else if (fileUri.scheme === "file") {
    try {
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(contentBytes).toString("utf8");
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
  return null;
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
    vscode.window.showInformationMessage("No files to copy.");
    return;
  }

  let combinedContent = "";
  let successCount = 0;
  for (const uri of uris) {
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
  }
}

async function aggregateToNewFile(tabs: vscode.Tab[]) {
  const cleanupComment = "<!-- Aggregated file contents -->"; // Using an HTML comment for Markdown

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

  let aggregatedContent = "";
  for (const tab of tabs) {
    if (tab.input instanceof vscode.TabInputText) {
      const fileData = await getFileData(tab.input.uri);
      if (fileData) {
        aggregatedContent += formatFileAsMarkdown(fileData);
      }
    }
  }

  if (aggregatedContent) {
    const newDoc = await vscode.workspace.openTextDocument({
      content: `${cleanupComment}\n\n${aggregatedContent.trim()}`,
      language: "markdown",
    });
    await vscode.window.showTextDocument(newDoc);
  } else {
    vscode.window.showInformationMessage("No text files found to aggregate.");
  }
}

export function deactivate() {}

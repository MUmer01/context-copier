import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // 1. Copy Selected File(s) from File Explorer (supports multi-selection)
  const copySelectedFiles = vscode.commands.registerCommand(
    'context-copier.copySelectedFiles',
    async (clickedFile?: vscode.Uri, allSelectedFiles?: vscode.Uri[]) => {
      let urisToProcess: vscode.Uri[] = [];

      if (allSelectedFiles && allSelectedFiles.length > 0) {
        urisToProcess = allSelectedFiles;
      } else if (clickedFile) {
        urisToProcess = [clickedFile];
      } else if (vscode.window.activeTextEditor) {
        urisToProcess = [vscode.window.activeTextEditor.document.uri];
      }

      if (urisToProcess.length > 0) {
        await copyToClipboard(urisToProcess);
      } else {
        vscode.window.showInformationMessage('No file(s) selected to copy.');
      }
    },
  );

  // 2. Open All Files Recursively Within a Folder (respects .gitignore)
  const openAllFolderFiles = vscode.commands.registerCommand(
    'context-copier.openAllFolderFiles',
    async (folderUri?: vscode.Uri) => {
      await openAllFolderFilesHandler(folderUri);
    },
  );

  // 3. Copy Active Text Editor (Keyboard Shortcut)
  const copyCurrentFile = vscode.commands.registerTextEditorCommand(
    'context-copier.copyCurrentFile',
    async (editor) => {
      await copyToClipboard([editor.document.uri]);
    },
  );

  // 4. Copy Selected Tab (Single)
  const copySelectedTab = vscode.commands.registerCommand(
    'context-copier.copySelectedTab',
    async (arg: vscode.Uri | vscode.Tab | undefined) => {
      const uri = resolveUriFromArgument(arg);

      if (uri) {
        await copyToClipboard([uri]);
      } else {
        vscode.window.showWarningMessage(
          'Could not determine file path for this tab.',
        );
      }
    },
  );

  // 5. Copy All Tabs
  const copyAllTabs = vscode.commands.registerCommand(
    'context-copier.copyAllTabs',
    async () => {
      const uris = getAllOpenTabUris();
      await copyToClipboard(uris);
    },
  );

  // 6. Aggregate Selected Tab (Single)
  const aggregateSelectedTab = vscode.commands.registerCommand(
    'context-copier.aggregateSelectedTab',
    async (arg: vscode.Uri | vscode.Tab | undefined) => {
      const uri = resolveUriFromArgument(arg);

      if (uri) {
        await aggregateToNewFile([uri]);
      } else {
        vscode.window.showWarningMessage(
          'Could not determine file path for this tab.',
        );
      }
    },
  );

  // 7. Aggregate All Tabs
  const aggregateAllTabs = vscode.commands.registerCommand(
    'context-copier.aggregateAllTabs',
    async () => {
      const uris = getAllOpenTabUris();
      await aggregateToNewFile(uris);
    },
  );

  context.subscriptions.push(
    copySelectedFiles,
    openAllFolderFiles,
    copyCurrentFile,
    copySelectedTab,
    copyAllTabs,
    aggregateSelectedTab,
    aggregateAllTabs,
  );
}

// --- Helper Functions ---

/**
 * Access the built-in VS Code Git extension API.
 */
async function getGitRepository(uri: vscode.Uri) {
  try {
    const gitExtension = vscode.extensions.getExtension<any>('vscode.git');
    if (!gitExtension) {
      return null;
    }

    const gitApi = gitExtension.isActive
      ? gitExtension.exports.getAPI(1)
      : (await gitExtension.activate())?.getAPI(1);

    if (!gitApi) {
      return null;
    }

    return (
      gitApi.getRepository(uri) ||
      gitApi.repositories.find((r: any) =>
        uri.fsPath.startsWith(r.rootUri.fsPath),
      ) ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Recursively retrieves all file URIs in a directory,
 * ignoring files/folders matched by .gitignore.
 */
async function getFilesInFolder(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const repository = await getGitRepository(folderUri);

  async function traverse(currentUri: vscode.Uri) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(currentUri);

      // Always exclude internal .git directory
      const validEntries = entries.filter(([name]) => name !== '.git');
      if (validEntries.length === 0) {
        return;
      }

      // Check entries against Git ignore rules in batch
      let ignoredSet = new Set<string>();
      if (repository) {
        try {
          const pathsToCheck: string[] = [];
          for (const [name, type] of validEntries) {
            const childUri = vscode.Uri.joinPath(currentUri, name);
            pathsToCheck.push(childUri.fsPath);
            if (type === vscode.FileType.Directory) {
              pathsToCheck.push(childUri.fsPath + path.sep);
            }
          }
          const result = await repository.checkIgnore(pathsToCheck);
          ignoredSet = new Set(result);
        } catch (err) {
          console.warn('Git checkIgnore failed:', err);
        }
      }

      for (const [name, type] of validEntries) {
        // Fallback: If not in a git repo, always ignore node_modules
        if (!repository && name === 'node_modules') {
          continue;
        }

        const childUri = vscode.Uri.joinPath(currentUri, name);
        const isDirectory = type === vscode.FileType.Directory;

        // Check whether this file or folder is ignored by git
        const isIgnored =
          ignoredSet.has(childUri.fsPath) ||
          ignoredSet.has(childUri.fsPath + path.sep) ||
          ignoredSet.has(childUri.fsPath + '/');

        if (isIgnored) {
          continue; // Prune ignored folder or file
        }

        if (isDirectory) {
          await traverse(childUri);
        } else if (type === vscode.FileType.File) {
          files.push(childUri);
        } else if (type === vscode.FileType.SymbolicLink) {
          try {
            const stat = await vscode.workspace.fs.stat(childUri);
            if (stat.type === vscode.FileType.File) {
              files.push(childUri);
            } else if (stat.type === vscode.FileType.Directory) {
              await traverse(childUri);
            }
          } catch {
            // Broken symlink, ignore
          }
        }
      }
    } catch (error) {
      console.error(
        `Failed to read directory: ${currentUri.toString()}`,
        error,
      );
    }
  }

  await traverse(folderUri);
  return files;
}

/**
 * Handles opening all files in a folder recursively.
 */
async function openAllFolderFilesHandler(folderUri?: vscode.Uri) {
  if (!folderUri) {
    vscode.window.showWarningMessage('No folder selected.');
    return;
  }

  const files = await getFilesInFolder(folderUri);

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      'No non-ignored files found in the selected folder.',
    );
    return;
  }

  const WARN_THRESHOLD = 30;
  if (files.length > WARN_THRESHOLD) {
    const confirmation = await vscode.window.showWarningMessage(
      `This folder contains ${files.length} files (excluding .gitignore). Opening all of them might slow down VS Code. Do you want to continue?`,
      { modal: true },
      'Open All',
    );

    if (confirmation !== 'Open All') {
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Opening ${files.length} files...`,
      cancellable: false,
    },
    async () => {
      for (const fileUri of files) {
        await vscode.commands.executeCommand('vscode.open', fileUri, {
          preview: false, // Keep tab pinned
          preserveFocus: true, // Avoid window flickering
        });
      }
    },
  );
}

/**
 * Helper to resolve the URI whether the command was called via:
 * 1. Context menu (provides vscode.Uri)
 * 2. API/Other (might provide vscode.Tab)
 * 3. Command Palette (provides undefined -> use active tab)
 */
function resolveUriFromArgument(
  arg: vscode.Uri | vscode.Tab | undefined,
): vscode.Uri | null {
  if (arg instanceof vscode.Uri) {
    return arg;
  }

  if (arg && typeof arg === 'object' && 'input' in arg) {
    return getUriFromTab(arg as vscode.Tab);
  }

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
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  if (input && typeof input === 'object' && 'uri' in input) {
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
  fileUri: vscode.Uri,
): Promise<{ relativePath: string; content: string } | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

  // Handle Untitled files (unsaved)
  if (fileUri.scheme === 'untitled') {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString(),
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
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString(),
    );

    let content = '';
    if (openDoc) {
      content = openDoc.getText();
    } else {
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      content = Buffer.from(contentBytes).toString('utf8');
    }

    let relativePath = workspacePath
      ? path.relative(workspacePath, fileUri.fsPath)
      : fileUri.fsPath;

    relativePath = relativePath.split(path.sep).join('/');

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
  const content = fileData.content.endsWith('\n')
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
    vscode.window.showInformationMessage('No files found to copy.');
    return;
  }

  let combinedContent = '';
  let successCount = 0;

  const uniqueUris = Array.from(new Set(uris.map((u) => u.toString()))).map(
    (s) => vscode.Uri.parse(s),
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
      `Copied content of ${successCount} file(s) to clipboard.`,
    );
  } else {
    vscode.window.showWarningMessage(
      'Could not read content from selected files.',
    );
  }
}

async function aggregateToNewFile(uris: vscode.Uri[]) {
  if (!uris || uris.length === 0) {
    vscode.window.showInformationMessage('No files found to copy.');
    return;
  }

  const cleanupComment = '<!-- Aggregated file contents -->';

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
        'workbench.action.closeActiveEditor',
      );
    }
  }

  const uniqueUris = Array.from(new Set(uris.map((u) => u.toString()))).map(
    (s) => vscode.Uri.parse(s),
  );

  let aggregatedContent = '';
  for (const uri of uniqueUris) {
    const fileData = await getFileData(uri);
    if (fileData) {
      aggregatedContent += formatFileAsMarkdown(fileData);
    }
  }

  if (aggregatedContent) {
    const newDoc = await vscode.workspace.openTextDocument({
      content: `${cleanupComment}\n\n${aggregatedContent.trim()}`,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(newDoc);
  } else {
    vscode.window.showInformationMessage(
      'No readable text files found to aggregate.',
    );
  }
}

export function deactivate() {}

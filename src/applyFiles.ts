import * as vscode from "vscode";
import * as path from "path";

export interface ParsedFile {
  relativePath: string;
  content: string;
}

type FileStatus = "new" | "modified" | "unchanged";

interface FileApplyCandidate {
  relativePath: string;
  targetUri: vscode.Uri;
  content: string;
  status: FileStatus;
}

const KNOWN_EXTENSIONLESS_FILES = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "license",
  "readme",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".eslintrc",
  ".prettierrc",
  ".env",
  ".npmrc",
  ".nvmrc",
]);

const SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "bat",
  "console",
  "terminal",
  "diff",
]);

/**
 * Command handler: Parses markdown from clipboard and applies files to workspace.
 */
export async function applyFromClipboardHandler(): Promise<void> {
  const clipboardText = await vscode.env.clipboard.readText();
  if (!clipboardText || !clipboardText.trim()) {
    vscode.window.showWarningMessage("Clipboard is empty.");
    return;
  }

  await applyFilesFromMarkdownText(clipboardText);
}

/**
 * Command handler: Parses markdown from the active text editor and applies files to workspace.
 */
export async function applyFromActiveEditorHandler(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor found.");
    return;
  }

  const text = editor.document.getText();
  if (!text.trim()) {
    vscode.window.showWarningMessage("Active document is empty.");
    return;
  }

  await applyFilesFromMarkdownText(text);
}

/**
 * Parses fenced code blocks with associated file paths from an AI Markdown response.
 */
export function parseFilesFromMarkdown(markdown: string): ParsedFile[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parsedMap = new Map<string, string>();

  let i = 0;
  let lastFenceCloseLine = -1;

  while (i < lines.length) {
    const openMatch = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!openMatch) {
      i++;
      continue;
    }

    const fence = openMatch[1];
    const fenceChar = fence[0];
    const fenceLength = fence.length;
    const infoString = openMatch[2].trim();

    // CommonMark rule: backtick fence info strings cannot contain backticks
    if (fenceChar === "`" && infoString.includes("`")) {
      i++;
      continue;
    }

    const fenceStartLine = i;
    const contentLines: string[] = [];
    i++;

    while (i < lines.length) {
      const closeMatch = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === fenceChar &&
        closeMatch[1].length >= fenceLength
      ) {
        break;
      }
      contentLines.push(lines[i]);
      i++;
    }

    // If no closing fence was found, ignore malformed block
    if (i >= lines.length) {
      break;
    }

    const lang = infoString.split(/\s+/)[0].toLowerCase();
    let filePath = findPrecedingFilePath(
      lines,
      fenceStartLine,
      lastFenceCloseLine,
      lang,
    );

    // Fallback: check if first line inside the code block is a file path comment (e.g. // src/app.ts)
    if (!filePath && contentLines.length > 0 && !SHELL_LANGUAGES.has(lang)) {
      const commentPath = extractPathFromFirstLineComment(contentLines[0]);
      if (commentPath) {
        filePath = commentPath;
        contentLines.shift();
      }
    }

    if (filePath) {
      let content = contentLines.join("\n");
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      parsedMap.set(filePath, content);
    }

    lastFenceCloseLine = i;
    i++;
  }

  return Array.from(parsedMap.entries()).map(([relativePath, content]) => ({
    relativePath,
    content,
  }));
}

function findPrecedingFilePath(
  lines: string[],
  fenceStartLine: number,
  lastFenceCloseLine: number,
  lang: string,
): string | null {
  let nonEmptyChecked = 0;

  for (let idx = fenceStartLine - 1; idx > lastFenceCloseLine; idx--) {
    const trimmed = lines[idx].trim();

    // Skip blank lines and markdown horizontal rules (---, ***, ___)
    if (!trimmed || /^[-*_]{3,}$/.test(trimmed)) {
      continue;
    }

    nonEmptyChecked++;
    const extracted = extractFilePathFromLine(trimmed, lang);
    if (extracted) {
      return extracted;
    }

    // Only inspect up to 3 non-empty lines above the code block
    if (nonEmptyChecked >= 3) {
      break;
    }
  }

  return null;
}

function extractFilePathFromLine(line: string, lang: string): string | null {
  // Prefer explicit inline code span if the line contains one (e.g. "### `/src/extension.ts`" or "**`package.json`**:")
  const backtickMatches = Array.from(line.matchAll(/`([^`]+)`/g));
  if (backtickMatches.length === 1) {
    const insideBackticks = normalizeCandidatePath(backtickMatches[0][1]);
    const outsideBackticks = line
      .replace(/`[^`]+`/, "")
      .replace(/[#*:_\-\d.>]/g, "")
      .replace(
        /\b(file|path|filename|create|update|updated|modified|new)\b/gi,
        "",
      )
      .trim();

    if (
      outsideBackticks.length <= 15 &&
      looksLikeFilePath(insideBackticks, lang)
    ) {
      return insideBackticks;
    }
  }

  // Otherwise, clean markdown decorations from the whole line
  let cleaned = line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:file|filename|path)\s*:\s*/i, "")
    .replace(/\s*\((?:new|updated|created|modified)\)\s*$/i, "")
    .replace(/:\s*$/, "")
    .trim();

  cleaned = unwrapMarkdown(cleaned);
  const normalized = normalizeCandidatePath(cleaned);

  if (looksLikeFilePath(normalized, lang)) {
    return normalized;
  }

  return null;
}

function extractPathFromFirstLineComment(firstLine: string): string | null {
  const match = firstLine
    .trim()
    .match(
      /^(?:\/\/|#|<!--|--|\/\*)\s*(?:filepath|file|path)?\s*:?\s*([^\s*<>|?"]+)(?:\s*-->|\s*\*\/)?\s*$/i,
    );

  if (!match) {
    return null;
  }

  const candidate = normalizeCandidatePath(match[1]);
  if (looksLikeFilePath(candidate, "")) {
    return candidate;
  }

  return null;
}

function unwrapMarkdown(text: string): string {
  let current = text.trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [start, end] of [
      ["**", "**"],
      ["__", "__"],
      ["`", "`"],
      ["*", "*"],
      ["_", "_"],
    ]) {
      if (
        current.startsWith(start) &&
        current.endsWith(end) &&
        current.length > start.length + end.length
      ) {
        current = current
          .slice(start.length, current.length - end.length)
          .trim();
        changed = true;
      }
    }
  }

  return current;
}

function normalizeCandidatePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function looksLikeFilePath(candidate: string, lang: string): boolean {
  if (!candidate || candidate.length > 260) {
    return false;
  }

  if (
    /^https?:\/\//i.test(candidate) ||
    /\s/.test(candidate) ||
    /[<>|?*"']/.test(candidate) ||
    candidate.endsWith("/")
  ) {
    return false;
  }

  if (
    SHELL_LANGUAGES.has(lang) &&
    !/\.(sh|bash|zsh|ps1|bat|cmd|diff|patch)$/i.test(candidate)
  ) {
    return false;
  }

  const baseName = path.posix.basename(candidate).toLowerCase();
  const hasSlash = candidate.includes("/");
  const hasExtension = /\.[a-z0-9]{1,12}$/i.test(baseName);

  return hasSlash || hasExtension || KNOWN_EXTENSIONLESS_FILES.has(baseName);
}

async function applyFilesFromMarkdownText(markdownText: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage(
      "Please open a folder or workspace before applying files.",
    );
    return;
  }

  const targetFolder =
    workspaceFolders.length === 1
      ? workspaceFolders[0]
      : await vscode.window.showWorkspaceFolderPick({
          placeHolder: "Select workspace folder to apply files into",
        });

  if (!targetFolder) {
    return;
  }

  const parsedFiles = parseFilesFromMarkdown(markdownText);
  if (parsedFiles.length === 0) {
    vscode.window.showWarningMessage(
      "No file blocks found. Make sure each code block is preceded by a file path (e.g. `/src/file.ts`).",
    );
    return;
  }

  const rootFsPath = path.resolve(targetFolder.uri.fsPath);
  const candidates: FileApplyCandidate[] = [];

  for (const parsed of parsedFiles) {
    const resolvedTarget = path.resolve(rootFsPath, parsed.relativePath);
    const relativeCheck = path.relative(rootFsPath, resolvedTarget);

    // Prevent path traversal outside workspace root
    if (
      relativeCheck.startsWith("..") ||
      path.isAbsolute(relativeCheck) ||
      !relativeCheck
    ) {
      continue;
    }

    const targetUri = vscode.Uri.file(resolvedTarget);
    const status = await getFileStatus(targetUri, parsed.content);

    candidates.push({
      relativePath: parsed.relativePath,
      targetUri,
      content: parsed.content,
      status,
    });
  }

  if (candidates.length === 0) {
    vscode.window.showWarningMessage("No valid workspace file paths found.");
    return;
  }

  const quickPickItems = candidates.map((candidate) => {
    let icon = "$(new-file)";
    let description = "New file";

    if (candidate.status === "modified") {
      icon = "$(edit)";
      description = "Overwrite existing";
    } else if (candidate.status === "unchanged") {
      icon = "$(check)";
      description = "Unchanged";
    }

    return {
      label: `${icon} ${candidate.relativePath}`,
      description,
      picked: candidate.status !== "unchanged",
      candidate,
    };
  });

  const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
    canPickMany: true,
    title: `Apply Files to "${targetFolder.name}"`,
    placeHolder: "Select files to create or update (press Enter to apply)",
  });

  if (!selectedItems || selectedItems.length === 0) {
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;
  const writtenUris: vscode.Uri[] = [];

  for (const item of selectedItems) {
    const { targetUri, content, status } = item.candidate;
    await writeFileSafely(targetUri, content);
    writtenUris.push(targetUri);

    if (status === "new") {
      createdCount++;
    } else {
      updatedCount++;
    }
  }

  const action = await vscode.window.showInformationMessage(
    `Applied ${writtenUris.length} file(s): ${createdCount} created, ${updatedCount} updated.`,
    "Open Applied Files",
  );

  if (action === "Open Applied Files") {
    for (const uri of writtenUris) {
      await vscode.commands.executeCommand("vscode.open", uri, {
        preview: false,
        preserveFocus: true,
      });
    }
  }
}

async function getFileStatus(
  targetUri: vscode.Uri,
  newContent: string,
): Promise<FileStatus> {
  const openDoc = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === targetUri.toString(),
  );

  if (openDoc) {
    return openDoc.getText() === newContent ? "unchanged" : "modified";
  }

  try {
    const existingBytes = await vscode.workspace.fs.readFile(targetUri);
    const existingText = Buffer.from(existingBytes).toString("utf8");
    return existingText === newContent ? "unchanged" : "modified";
  } catch {
    return "new";
  }
}

async function writeFileSafely(
  targetUri: vscode.Uri,
  content: string,
): Promise<void> {
  const openDoc = vscode.workspace.textDocuments.find(
    (d) => d.uri.toString() === targetUri.toString(),
  );

  if (openDoc) {
    const edit = new vscode.WorkspaceEdit();
    const lastLine = Math.max(0, openDoc.lineCount - 1);
    const lastChar = openDoc.lineAt(lastLine).text.length;
    const fullRange = new vscode.Range(0, 0, lastLine, lastChar);

    edit.replace(targetUri, fullRange, content);
    await vscode.workspace.applyEdit(edit);
    await openDoc.save();
    return;
  }

  const parentDir = vscode.Uri.file(path.dirname(targetUri.fsPath));
  await vscode.workspace.fs.createDirectory(parentDir);
  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(content, "utf8"));
}

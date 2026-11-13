# Context Copier

## Overview

Context Copier is a VS Code extension designed to streamline your AI coding and code-sharing workflow in **both directions**:

1. **Copy Context Out:** Grab relative file paths and contents from one or multiple files in a single action to paste into Gemini, ChatGPT, Claude, code reviews, or documentation.
2. **Apply AI Changes Back:** Parse an AI's Markdown response straight from your clipboard (or an open document) and create or update all files and folders in your workspace at once—with a preview before anything is written.

## Core Features

- **Dual Copy Modes:** Copy file paths and contents directly to your **clipboard** or **combine them into a new Markdown document**.
- **Flexible Selection:** Grab content from a single file, multi-selections in the Explorer, an individual tab, or all open tabs at once.
- **One-Click Apply from AI Responses:** Automatically parses file blocks from Gemini, ChatGPT, or Claude responses, creates missing parent folders, and updates existing files in bulk.
- **Safe Preview Before Writing:** Displays a QuickPick list marking each detected file as **New file**, **Overwrite existing**, or **Unchanged** (with unchanged files unchecked by default) before modifying your workspace.
- **Gitignore-Respecting Folder Opener:** Recursively opens all files in a folder into editor tabs while excluding `.git` and `.gitignore` paths.
- **Handles Unsaved Buffers:** Works with unsaved files (e.g., `Untitled-1`) and unsaved edits in open tabs.
- **Path Safety:** Normalizes relative paths and prevents path traversal outside your workspace root.

## How to Use

### Copying Code for AI / Documentation

#### 1. From the File Explorer

- **Selected File(s):** Right-click single or multiple selected files in the Explorer → click **Context Copier: Copy Path & Content of Selected File(s)**.
- **Folders:** Right-click any folder → click **Context Copier: Open All Files in Folder** to open non-ignored files into editor tabs.

#### 2. From an Editor Tab

Right-click on any open tab at the top of the editor:

- **Context Copier: Copy Path & Content of This Tab:** Copies the tab's relative path and content.
- **Context Copier: Copy Path & Content of All Open Tabs:** Copies all open editor tabs.
- **Context Copier: Combine This Tab into New File:** Opens the tab's content in a new Markdown document.
- **Context Copier: Combine All Open Tabs into New File:** Aggregates all open tabs into a single new Markdown document.

#### 3. From the Active Editor / Command Palette

- **Keyboard Shortcut:** Press `Ctrl+Alt+C` (`Cmd+Alt+C` on macOS) to copy the active file directly to the clipboard.
- **Command Palette:** Press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) and type `Context Copier`.

---

### Applying AI-Generated Files Back to VS Code

1. Copy the AI response in your browser (e.g., using the **Copy response** button in Gemini, ChatGPT, or Claude).
2. In VS Code, run **Context Copier: Apply Files from Clipboard** using `Ctrl+Alt+V` (`Cmd+Alt+V` on macOS), the Explorer right-click menu, or the Command Palette.
   - Alternatively, paste the response into a tab, edit if needed, right-click the tab, and choose **Context Copier: Apply Files from Active Document**.
3. Review the detected files in the preview list (`New file`, `Overwrite existing`, `Unchanged`) and press `Enter` to apply.

#### Supported File Path Formats

Context Copier automatically detects fenced code blocks preceded by common Markdown path headers (as well as variable-length fences like ` ` ```` for nested code blocks):

- `` `/src/extension.ts` `` (Context Copier's native format)
- `### src/extension.ts` or `**src/extension.ts**`
- `File: src/extension.ts`
- First-line comments inside code blocks (e.g., `// src/extension.ts` or `# utils/helper.py`)

> **Tip for AI Chats:** Add this instruction to your prompt or AI custom instructions so responses always apply cleanly:
> _"When creating or updating files, output the complete file content in a fenced code block immediately preceded by the file path in backticks (e.g., `` `/src/example.ts` ``)."_

## Keyboard Shortcuts

| Command                            | Windows / Linux | macOS       |
| ---------------------------------- | --------------- | ----------- |
| Copy Path & Content of Active File | `Ctrl+Alt+C`    | `Cmd+Alt+C` |
| Apply Files from Clipboard         | `Ctrl+Alt+V`    | `Cmd+Alt+V` |

## Example Output

When copying files, the resulting Markdown structure looks like this:

````markdown
---
`/src/main.js`

```
import { helper } from './utils/helper.js';
function main() {
    console.log(helper());
}
main();
```
---

---

`/src/utils/helper.js`

```
export function helper() {
    return "Hello from helper!";
}
```

---
````

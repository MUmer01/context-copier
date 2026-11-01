# Context Copier

## Overview

Context Copier is a VS Code extension designed to streamline your workflow when you need to share code. It eliminates the tedious process of manually copying and pasting files one by one.

Whether you're crafting a prompt for an AI assistant like ChatGPT/Claude, preparing a code review, or compiling documentation, Context Copier lets you grab the relative path and content of one or multiple files in a single action.

## Core Features

- **Dual Output Modes:** Copy content directly to your **clipboard** or **combine it into a new, temporary document**.
- **Flexible Selection:** Grab content from a single file, multi-selections in the Explorer, active tabs, or all open tabs at once.
- **Gitignore Respecting Directory Opener:** Recursively opens all files in a folder into editor tabs while excluding `.git` and `.gitignore` paths.
- **Intelligent Path Handling:** Automatically formats relative file paths to preserve project hierarchy.
- **Handles Unsaved Files:** Works with unsaved files (e.g., `Untitled-1`) and unsaved dirty buffers in memory.

## How to Use

### 1. From the File Explorer

- **Selected File(s):** Right-click single or multiple selected files in the Explorer $\rightarrow$ click **Context Copier: Copy Path & Content of Selected File(s)**.
- **Folders:** Right-click any folder $\rightarrow$ click **Context Copier: Open All Files in Folder** to open non-ignored files into editor tabs.

### 2. From an Editor Tab

Right-click on any open tab at the top of the editor:

- **Copy Path & Content of This Tab:** Copies the active tab's relative path and content.
- **Copy Path & Content of All Open Tabs:** Copies all open editor tabs.
- **Combine This Tab into New File:** Opens the single tab content in a new Markdown document.
- **Combine All Open Tabs into New File:** Aggregates all open tabs into a single new Markdown document.

### 3. From the Active Editor / Shortcut

- **Keyboard Shortcut:** Press `Ctrl+Alt+C` (`Cmd+Alt+C` on macOS) to copy the active file directly to the clipboard.
- **Command Palette:** Press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) and type `Context Copier`.

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

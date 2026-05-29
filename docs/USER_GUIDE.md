# Hmm-code User Guide

A walkthrough of every UI feature in the VS Code extension.

> Feature semantics and workflow live in the companion repo
> [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi):
> - [Workflow](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/WORKFLOW.md)
> - [Permissions](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/PERMISSIONS.md)
> - [AGENTS.md](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/AGENTS-MD.md)
>
> This guide only covers *how to use them inside VS Code*.

---

## 1. Opening a chat

### Sidebar
- Click the Hmm icon in the Activity Bar
- Or run `Cmd+Shift+P` → "Hmm-code: Open Chat in Sidebar"

### Editor panel (new tab)
- Click the `H` icon (PNG logo) in the editor title bar
- Or run `Cmd+Shift+P` → "Hmm-code: New Chat Panel"
- Multiple panels can coexist — each tab is an independent Pi process

### Panel persistence
VS Code window reload / restart → every tab restores automatically. The session file you had open last reattaches as well (webview persisted state).

---

## 2. The chat footer (picker row)

Left to right: **mode picker** · **model picker** · **thinking picker** · **↺ reset** (conditional) · **🔒 Auto** toggle · right end: **ctx %** · **↑ send / ■ stop**

| Button | Action |
|---|---|
| **mode picker** | Click → 4-mode picker. Mode-colored chip (code = white, plan = blue, debug = purple, ask = orange). |
| **model picker** | Click → available models. Alias is shown as the primary label with the raw id as a sublabel. |
| **thinking picker** | Click → supported thinking levels for the active model. |
| **↺ reset** | Only visible when the current model/thinking differs from the mode default. Click → restore mode defaults. |
| **🔒 Auto / 🔓 Auto** | Toggles permission auto-approve (see [§5](#5-auto-approve)). |
| **ctx XX%** | Context window usage. |
| **↑ / ■** | Send / abort the in-flight turn. |

---

## 3. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send the message |
| `Shift+Enter` | Newline |
| `Tab` / `Shift+Tab` | Cycle modes (when the prompt has focus) |
| `Cmd/Ctrl + click` on a file path inside a tool call | Open that file in the editor |

The extension's VS Code commands (mode cycle, thinking toggle, reset, abort, restart, etc.) live in the Command Palette without default keybindings — VS Code intercepts most modifier combos before they reach the webview, so binding them would be a lie. Use `keybindings.json` to add your own if you want shortcuts.

Pi TUI shortcuts (`Alt+T`, `Alt+X`, `Ctrl+Shift+A`) are described in the [Pi extension README](https://github.com/lbm1202/hmm-code-pi#tui-keybindings). They apply only when driving Hmm-code from the terminal.

---

## 4. Tool-call rendering

### Generic tools (`read` / `grep` / `find` / `ls` / `bash`)
- One-line summary: `bash` shows the first command line + `(+N lines)` hint; `read` shows path + `[start-end]`.
- Outputs longer than 10 lines collapse with an `N lines` hint.
- Errors get a red `✗`; successes have no badge (raw output stands on its own).

### `edit` / `write` / `multi_edit` (diff view)
- **Clickable path header** — Ctrl/Cmd + click opens the file in the editor.
- Line-level unified diff (LCS-based):
  - Deletions: red background + `-` prefix
  - Additions: green background + `+` prefix
  - Unchanged lines: gray (context)
- Single-line edits get inline word-diff — only the changed slice is highlighted.
- All diffs use [**Shiki syntax highlighting**](https://shiki.style/) — Dark+ theme across 25+ languages (ts / tsx / js / py / css / html / json / md / sh / go / rust / java / c / cpp / yaml / toml / sql / vue / svelte / xml / diff / ini / scss / jsx / jsonc, etc.)
- Unsupported extensions or pre-Shiki-init falls back to plain text.

### `read` results
- File extension → Shiki block tokenization (preserves multi-line comment / string context).

### Interactive tools (`ask_user` / `todo_write` / `finalize_plan` / `request_mode_switch`)
- Card UI — question + options, todo checklists, accept/decline buttons.
- Raw JSON is suppressed to save context.

### Sanitized markdown
- Model output is rendered via marked → DOMPurify. `<script>`, `on*` handlers, `javascript:` URLs, `<iframe>` / `<object>` / `<embed>` / `<form>` are stripped before reaching the DOM.

---

## 5. Auto-approve

The **🔒 Auto** button in the chat footer.

- **Off (gray padlock)**: every `ask` verdict from the permission system surfaces a confirm dialog.
- **On (orange 🔓)**: every `ask` verdict auto-passes. `deny` still blocks (`ask` is the only thing being bypassed).

Session-scoped — flipping to a new session resets to OFF. Never persisted (deliberate).

**Toggles take effect mid-turn** — the next tool call sees the new state. Dialogs that are already on screen need to be answered by the user (auto-dismissing them would be more confusing than helpful).

The toggle goes over an internal RPC channel, so the slash command doesn't appear as a user bubble.

The TUI equivalent is `Ctrl+Shift+A`. There is no VS Code keybinding because the combo gets intercepted before reaching the webview — use the button.

---

## 6. Permission confirm dialog

When the permission system returns `ask`, the webview shows a modal:

> **Permission**
>
> Mode "code" → bash command needs approval: `rm -rf node_modules`
>
> Allow this action?
>
> **[Deny]** &nbsp;&nbsp; **[Allow]**

- **Allow**: this call only. The next time the same command is invoked, it asks again.
- **Deny**: tool result returns to Pi as `isError: true` + "User denied" — the LLM can choose another approach.

For repeated approvals, either toggle Auto on or add an `allow` rule under `permissions` in `modes.json`.

---

## 7. Session picker (🕘)

Click the 🕘 button at the top → session tree modal.

- **Parent-child tree**: sessions spawned via `finalize_plan` (new-session branch) link to their parent and render as a tree.
- **`▶ / ▼`**: expand/collapse children.
- **Row click**: switch to that session.
- **✏️**: rename (stored in the sidecar `.pi-modes-names.json` — Pi's session files stay immutable).
- **🗑**: delete. If the session has children, a cascade warning appears.
  - **Deleting the active session auto-spawns a fresh one** so the UI never shows a dead session.

---

## 8. Settings panel

Footer ⚙ button or `Cmd+Shift+P` → "Hmm-code: Open Settings". Full reference: [SETTINGS.md](SETTINGS.md).

Summary:
- **Modes**: edit each mode's model / thinking.
- **Other model settings**: auto-title model (background job).
- **Model filter per provider**: allowlist that controls which models appear in the picker.
- **Provider auth**: API keys, Codex OAuth login.
- **Custom providers**: register self-hosted endpoints (vLLM / Ollama).

Saving triggers an auto-reload — every open chat tab picks up the new config.

---

## 9. Empty state (recent sessions)

A fresh tab with no session shows the centered Hmm logo + a "Recent sessions" list (top 5). Click any row to enter that session.

---

## 10. Color codes

| Mode | Color |
|---|---|
| code | white |
| plan | blue |
| debug | purple |
| ask | orange |

Used consistently across the mode picker chip, plan-handoff notifications, and the footer mode label.

---

## 11. Troubleshooting

### Chat doesn't respond
- The sidebar's top-right ↺ button (when visible) triggers `restartChat` — respawns the Pi process.
- Or `Cmd+Shift+P` → "Developer: Reload Window".

### Pi doesn't pick up new extension code
- The Pi process only loads extensions at startup.
- Send `/reload-runtime` in a chat tab (reloads that tab only).
- Or save anything in the settings panel — it triggers `reloadAll` automatically.

### Permission ask seems to deny forever
- Headless RPC sessions (no UI) auto-deny `ask` — Pi reports `ctx.hasUI === false` and the extension blocks. This is by design.
- Inside a normal chat the confirm modal should appear; if it doesn't, the modal-root may be hidden by another overlay or the webview is throwing — open "Developer: Open Webview Developer Tools" to inspect.

### Codex login completed but the models are missing
- A successful login auto-restarts every chat tab (`restartAll`).
- If they still don't appear, run "Developer: Reload Window".

### Settings panel model dropdown is empty
- If no chat has ever run, the model cache is empty.
- Open a chat tab once — when models are fetched, the settings panel auto-refreshes via the cache-observer pattern.
- The settings panel also issues a one-shot model fetch via the first live backend when it opens; the dropdown populates a moment later.

### Edit/write diffs render as plain text
- Shiki is still loading (first ~1-2 seconds after the extension activates) or the file extension isn't supported.
- The supported language list is in [README.md](../README.md#at-a-glance).
- Safe fallback — the diff structure is still rendered.

### `Pi launch source: system` in the Hmm-code output channel
- The bundled Pi wasn't shipped or wasn't extracted — usually means the installed `.vsix` predates the bundling commit, or the user override is misconfigured.
- Reinstall the `.vsix` from the [Releases page](https://github.com/lbm1202/hmm-code-vscode/releases) to fix.

---

## 12. Requirements

- VS Code 1.85+
- macOS / Linux / Windows (the bundled Pi runs on Electron's Node runtime — no separate Node install required).
- For source builds: Node 20+ and a GitHub SSH key (the build clones the private `hmm-code-pi` repo on first run unless a sibling clone or `HMM_CODE_PI_PATH` is provided).

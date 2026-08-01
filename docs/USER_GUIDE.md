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

Chat always opens as an **editor tab**. The sidebar is the session browser for
the current workspace folder — see [§7](#7-sidebar-session-list).

### From the sidebar (usual way)
- Click the Hmm icon in the Activity Bar (or `Cmd+Shift+P` → "Hmm-code: Show Sessions")
- **＋ New session** starts an empty chat; clicking a session row opens that session

### Straight to a new tab
- Click the `H` icon (PNG logo) in the editor title bar
- Or run `Cmd+Shift+P` → "Hmm-code: New Chat"

Multiple tabs can coexist — each is an independent Pi process. A session opens in
**one tab only**: picking a session that's already open reveals that tab instead
of starting a second agent on the same session file.

### Panel persistence
VS Code window reload / restart → every tab restores automatically. The session file you had open last reattaches as well (webview persisted state).

---

## 2. The chat footer (picker row)

Left to right: **mode picker** · **model picker** · **thinking picker** · **↺ reset** (conditional) · **🔒 Auto** toggle · right end: **ctx %** · **↑ send / ■ stop**

| Button | Action |
|---|---|
| **mode picker** | Click → 5-mode picker. Mode-colored chip (code = white, plan = blue, review = green, debug = purple, ask = orange). |
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
- Every finished call gets a **status dot** on its summary line — **green** for success, **red** for failure.
- On **success**, output longer than 10 lines collapses with an `N lines` hint. On **failure**, the result is hidden (only the red dot shows) — click the row to expand it.

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
- **Pinned task list** (on by default): when the agent runs `todo_write`, the full list is pinned to the top of the chat and updated live, while the in-stream block collapses to a one-line summary. A **Done** button appears once every task is complete and dismisses the panel; a later incomplete update re-shows it. Turn it off in settings → General to render the full list inline instead.

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

## 7. Sidebar session list

The Activity Bar view lists every session of the current workspace folder. It runs
no agent process of its own — it is a browser over the session files on disk.

- **＋ New session**: opens an empty chat tab.
- **Search box**: filters by session name; results render flat (a matching child
  isn't hidden behind a non-matching parent).
- **Row**: session name + relative time (`just now`, `5m ago`, `3d ago`, a date past
  a week). Click to open it in a tab.
- **Parent-child tree**: sessions spawned via `finalize_plan` (new-session branch)
  nest under their parent, with a descendant count; `▸ / ▾` expands and collapses.
- **● dot**: this session is currently open in a chat tab.
- **✎**: rename (stored in the sidecar `.pi-modes-names.json` — Pi's session files stay immutable).
- **🗑**: delete. If the session has children, a cascade warning appears.
  - A tab holding a deleted session (or one of its descendants) **moves to a fresh
    session first**, so no agent keeps writing to a file that's gone.
- **％ / ⚙︎**: subscription usage and the settings panel.

The chat tab keeps its own session list (🕘) and the recent-sessions shortcuts on
the empty state, so you can switch sessions without leaving the tab.

---

## 8. Settings panel

Footer ⚙ button or `Cmd+Shift+P` → "Hmm-code: Open Settings". Full reference: [SETTINGS.md](SETTINGS.md).

Five tabs:
- **General**: UI language, auto-title model, auto-summarization threshold (50–85%, default 70%) + dynamic-compaction / continue-after-compaction toggles, the summary (compaction) model, the *include old tool outputs* toggle, and the *pin task list to the top* toggle.
- **Authentication**: API keys, Codex / Claude OAuth logins, Codex usage readout.
- **Models**: custom providers (self-hosted vLLM / Ollama) + the per-provider model filter (allowlist).
- **Modes**: each mode's model / thinking level.
- **Prompts**: the five mode system prompts, the auto-title prompt, and compaction focus.

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
| review | green |
| ask | orange |

Used consistently across the mode picker chip, plan-handoff notifications, and the footer mode label.

---

## 11. Troubleshooting

### Chat doesn't respond
- `Cmd+Shift+P` → "Hmm-code: Restart Chat" respawns the Pi process behind every open tab.
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

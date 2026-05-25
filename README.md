# Hmm-code (VS Code Extension)

VS Code UI for the [Pi coding agent](https://github.com/badlogic/pi-mono).
Wraps `pi --mode rpc` in a Claude-Code-style native chat surface and pairs
with the [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) extension
(installed at `~/.pi/agent/extensions/modes`) for the plan/code/debug/ask
workflow.

## Architecture

```
VS Code Extension Host (Node)
  ├── spawn `pi --mode rpc`  (child process, stdio JSONL)
  ├── PiClient: framing + EventEmitter
  ├── ChatViewProvider: sidebar webview
  └── ChatPanel: editor-area webview (with serializer for reload persistence)

Webview (HTML/CSS/TS, 13 modules)
  ├── dispatch:        host → webview message router + Pi event handler
  ├── turn-lifecycle:  status row / bubble / rAF-debounced markdown stream
  ├── tools:           tool-call rendering (interactive + built-in pretty)
  ├── pickers:         mode/model/thinking dropdowns
  ├── modals:          question cards + confirm/input dialogs
  ├── session-picker:  parent-child tree with rename/delete
  ├── history:         past-message replay
  ├── prompt:          send/abort + key handlers
  └── helpers/dom/state/protocol/types

pi --mode rpc
  └── loads ~/.pi/agent/extensions/modes/   ← hmm-code-pi
```

The TUI-specific bits of the Pi extension (`setFooter`, `setHeader`,
`setEditorComponent`, `ctx.ui.custom`) become no-ops in RPC mode. This
extension provides equivalent native VS Code UI.

## Features

### Chat
- Sidebar chat (activity bar) + editor-area panels (multiple, independent)
- Live streaming with **rAF-debounced markdown render** — at most one
  `marked.parse` per animation frame, smooth even on multi-thousand-token responses
- Markdown HTML overrides `white-space: pre-wrap` so list indentation
  doesn't render as visible vertical gaps

### Interactive controls
- Mode / model / thinking dropdowns synced with Pi via `setStatus` hints
- Mode chip color-coded (code=white, plan=blue, debug=purple, ask=orange)
- Reset-to-defaults pill appears only when the active model/thinking
  diverges from the mode's configured default (mirrors Pi `overridden` status)
- `↑` send button doubles as `■` abort while a turn is in flight
- Tab / Shift+Tab cycle modes from the prompt

### Tool rendering
- **Interactive tools** (`ask_user`, `request_mode_switch`, `todo_write`,
  `finalize_plan`) get pretty result panels — QA lists, todo checklists,
  accept/decline status, etc.
- **`edit` / `write` / `multi_edit`** show a Claude-Code-style **diff
  body**: red `-` line + green `+` line, with word-level inline highlight
  for single-line changes. Auto-expanded on call. Renders from Pi's actual
  schema `{ path, edits: [{oldText, newText}, ...] }`.
- **`bash` / `read` / `grep` / `find` / `ls`** show a compact summary
  (command first line + `(+N lines)` hint for heredocs; file path for read).
  Long output (>10 lines) auto-collapses with a "N lines" summary hint.
- Success/failure markers: `✓ <message>` (green) or `✗ <error>` (red).

### Sessions
- Session tree picker — parent-child hierarchy, expand/collapse, rename
  (sidecar `.pi-modes-names.json`), cascade delete with descendant warning
- "이동" button to switch; click on title just expands (no accidental switch)
- Recent sessions list on empty state (5 most recent)
- Auto-title sessions from first user prompt (via Pi extension's
  `auto-title.ts`, using a small/fast GPT model)
- **Panel persistence across window reloads**: registers
  `WebviewPanelSerializer`, restores panel state, and the webview's
  persisted `lastSessionFile` triggers auto `switch_session` on ready

### Branding
- "Hmm" logo (green LED style): inline SVG in empty state, PNG for
  marketplace listing + editor title button (PNG bytes can't be re-tinted
  by VS Code's icon theming layer, so the brand green survives)
- Activity bar icon: monochrome SVG via `currentColor` for theme adaptation

## Commands & keybindings

| Command | Default key (when `hmm-code.focus`) |
|---|---|
| `Hmm-code: Open Chat in Sidebar` | — |
| `Hmm-code: New Chat Panel` | (editor title `H` button) |
| `Hmm-code: Cycle Mode` | `Shift+Tab` |
| `Hmm-code: Toggle Thinking Level` | `Alt+T` |
| `Hmm-code: Reset Model + Thinking` | `Alt+X` |
| `Hmm-code: Cancel Current Turn` | — |

## Develop

```bash
npm install
npm run build       # one-shot
npm run watch       # incremental
```

Then in VS Code: `F5` opens an Extension Development Host with this
extension loaded. Open the **Hmm-code** activity bar item (green `H`),
or run **Hmm-code: Open Chat in Sidebar** from the command palette.

## Install (locally)

```bash
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension hmm-code-0.2.0.vsix --force
```

After install: `Cmd+Shift+P` → `Developer: Reload Window`.

## Layout

```
src/
  extension.ts      activate(), command registry, WebviewPanelSerializer
  chat-view.ts      sidebar WebviewViewProvider
  chat-panel.ts     editor-area WebviewPanel factory + adopt for serializer
  chat-backend.ts   ChatBackend: PiClient ↔ webview bridge, renderChatHtml
  pi-client.ts      spawn pi --mode rpc, JSONL framing, response correlation
  rpc-types.ts      Pi RPC protocol types
  protocol.ts       Shared constants (kinds, status keys, session-reset cmds)
  session-manager.ts list/delete/rename sessions on disk
  info.ts           extract version + publisher from package.json

webview/
  main.ts           Bootstrap (~33 lines)
  dom.ts            APP_HTML, els refs, appendBubble/User/System, logo SVG
  state.ts          ui mirror, runtime flags, persistedSessionFile/setState
  protocol.ts       Mirror of src/protocol.ts (kind constants, MODE_NAMES, etc.)
  types.ts          ToWebview/FromWebview/SessionEntry/ModelEntry/etc.
  helpers.ts        md, escapeHtml, cssEscape, safeStringify, summarizeArgs
  dispatch.ts       window.message router (dispatch table) + Pi event handler
  turn-lifecycle.ts Status row / bubble / rAF-debounced markdown render
  tools.ts          Tool-call rendering: interactive + built-in pretty + edit diff
  pickers.ts        showPopover + wirePickers for mode/model/thinking
  modals.ts         showModal question cards + showConfirm/InputDialog
  session-picker.ts Session tree modal
  history.ts        renderHistory / renderRecentList / clearConversation
  prompt.ts         doSend / updateSendButton / updatePromptDisabled

media/
  icon.svg          Activity bar icon (monochrome, currentColor)
  icon.png          Marketplace listing (128×128, brand green)
  icon-32.png       Editor title button (32×32, brand green)
  tab-icon.svg      WebviewPanel tab icon (green H)
  logo.svg          Reserved (empty-state uses inline SVG in dom.ts)
```

See [`ANALYSIS.md`](ANALYSIS.md) for the per-file deep dive, refactor
history, and architectural decisions.

## Companion repo

[hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) — the Pi-side
extension this UI talks to over RPC. Install both for the full experience.

## License

Personal use.

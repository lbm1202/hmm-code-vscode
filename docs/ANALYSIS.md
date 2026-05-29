# Hmm-code VS Code Extension — Architecture Analysis

A file-by-file deep dive describing the current shape of the codebase and the design decisions behind it.

> Historical note: an earlier iteration had a single ~1600-line `webview/main.ts`. It was split into the per-responsibility modules described below; the refactor is complete and the boot file is now ~80 lines.

---

## 1. Layout

### Host (extension process)
| File | Purpose |
|---|---|
| `src/extension.ts` | `activate()`, command registration, launch-config wire-up |
| `src/pi-launcher.ts` | Decides bundled vs user-override vs system Pi at activation time |
| `src/chat-view.ts` | Sidebar `WebviewViewProvider` |
| `src/chat-panel.ts` | Editor-area `WebviewPanel` factory + serializer |
| `src/settings-panel.ts` | Standalone settings tab (modes / models / auth / permissions) |
| `src/chat-backend.ts` | **PiClient ↔ webview bridge** — session enumeration, sidecar names, plan handoff, model cache observer |
| `src/pi-client.ts` | Spawns `pi --mode rpc`, JSONL framing, EventEmitter |
| `src/rpc-types.ts` | Pi RPC type aliases |
| `src/protocol.ts` | Webview message kinds + `STATUS_KEYS` |
| `src/session-manager.ts` | Session listing + cascade delete |
| `src/oauth-codex.ts` | OpenAI Codex OAuth flow used by the settings panel |
| `src/info.ts` | Reads version from `package.json` for the banner |

### Webview (browser context)
| File | Purpose |
|---|---|
| `webview/main.ts` | IIFE entry — wires modules together (~80 lines) |
| `webview/dispatch.ts` | `window.addEventListener("message")` router + Pi event handler |
| `webview/turn-lifecycle.ts` | Status row / bubble / rAF-debounced markdown stream |
| `webview/tools.ts` | Tool-call rendering (interactive cards + built-in pretty + LCS diff) |
| `webview/syntax.ts` | Shiki lazy init + line/block highlighting |
| `webview/pickers.ts` | Mode / model / thinking dropdowns |
| `webview/modals.ts` | Question cards + confirm/input dialogs (incl. permission ask) |
| `webview/session-picker.ts` | Parent-child session tree with rename / delete |
| `webview/history.ts` | Past-message replay (alias-aware) |
| `webview/prompt.ts` | Send / abort + key handlers (IME-safe Enter, explicit Shift+Enter newline) |
| `webview/helpers.ts` | `md()` (marked + DOMPurify), `escapeHtml`, plan body, summarization |
| `webview/dom.ts` | DOM scaffold + cached element refs |
| `webview/state.ts` | UI state (runtime + ui mirrors), VS Code persisted state |
| `webview/protocol.ts` | Same shape as `src/protocol.ts` for the webview side |
| `webview/types.ts` | Shared TypeScript types |
| `webview/styles.css` | All styles |

---

## 2. Data flow

### Boot sequence
```
extension.ts activate()
  ↓ getPiLaunchConfig(ctx) → ChatBackend.setLaunchConfig(...)
  ↓ register sidebar + panel providers + commands
User opens a view
  ↓ resolveWebviewView → renderChatHtml → new ChatBackend(webview)
  ↓ backend.start(cwd) → new PiClient() → spawn (bundled) pi --mode rpc
  ↓ PiClient ↔ webview JSONL bridge online
  ↓ post({kind: "ready"})
webview main.ts IIFE
  ↓ window.message listener registered
  ↓ "ready" received → pollInitialState, request-models, request-context, list-sessions
```

### Message protocol (`kind` values)

**FromWebview (webview → host):**
`prompt`, `abort`, `ui-response`, `command`, `request-state`, `request-models`, `request-messages`, `request-context`, `list-sessions`, `delete-session`, `rename-session`, `open-settings`, `open-file`, `slash`

**ToWebview (host → webview):**
`ready`, `event`, `ui-request`, `ui-hint`, `state`, `sessions`, `models`, `messages`, `stderr`, `exit`

### Turn / Bubble / Status lifecycle
```
doSend → turnInFlight=true → ensureTurn (status row)
  ↓ Pi: message_start          → setStatusPhase("generating response")
  ↓ Pi: text_delta             → streamText (creates bubble lazily, renders markdown)
  ↓ Pi: thinking_delta         → streamThinking (details block)
  ↓ Pi: toolcall_end           → addToolCall (spinner + args)
  ↓ Pi: tool_execution_start/update/end → renders tool result
  ↓ Pi: message_end            → finalizeBubble (bubble = null)
  ↓ Pi: agent_end / turn_end   → finalizeTurn → removeStatus
```

---

## 3. Key contracts

### `STATUS_KEYS` (in both `src/protocol.ts` and `webview/protocol.ts`)
Mirrors `hmm-code-pi/constants.ts:STATUS_KEYS`. Keep in sync.

| Key | Emitter | Reader |
|---|---|---|
| `mode` | Pi `state.apply()` | webview picker chip |
| `model` | Pi `state.apply()` | webview picker chip |
| `thinking` | Pi `state.apply()` | webview thinking chip |
| `overridden` | Pi `state.pushStatus()` | webview reset button visibility |
| `context` | Pi `hooks.ts` | webview ctx pill |
| `plan-handoff` | Pi `finalize_plan` | webview `runPlanHandoff` |
| `auto-approve` | Pi `auto-approve` handler | webview button color/text |

### `BINARY_THINKING_FORMATS` (`commands.ts`)
`qwen-chat-template`, `qwen`, `zai` — these models flip between off and a remembered "on" level on toggle. Everything else cycles through supported levels.

### Plan handoff protocol
Pi `finalize_plan` → `setStatus("plan-handoff", "<path>|<targetMode>")` →
webview stores in `runtime.pendingPlanHandoff` →
on next `session_start/switch/loaded` event → `runPlanHandoff` waits up to 2 s for `ui.mode === targetMode`, then sends the implementation body.

---

## 4. Bundling pipeline

`esbuild.config.mjs` runs four steps:
1. Bundle `src/extension.ts` → `out/extension.js` (CJS, node target).
2. Bundle `webview/main.ts` → `out/webview/main.js` (IIFE, browser target, minified outside watch).
3. Copy `webview/styles.css` → `out/webview/styles.css`.
4. **`vendorBundle()`** — copies `node_modules/@earendil-works/pi-coding-agent` to `out/vendor/pi/` and the sibling/auto-cloned hmm-code-pi repo to `out/vendor/hmm-code-pi/`. Filters strip `.map`, `.d.ts`, and test files.

`.vscodeignore` excludes `node_modules/**` (everything dev-time) and `out/**/*.map`; the bundled `out/vendor/**` ships inside the `.vsix`.

Resulting .vsix size: ~22 MB (Pi runtime is the bulk; webview itself is ~2 MB after Shiki + DOMPurify + marked).

---

## 5. Launch resolution (`pi-launcher.ts`)

Always spawn the bundled Pi: `process.execPath` (Electron's Node) with `ELECTRON_RUN_AS_NODE=1`, args `[out/vendor/pi/dist/cli.js, --no-extensions, -e out/vendor/hmm-code-pi/index.ts]`. The `--no-extensions` flag ensures deterministic behavior (no conflict with whatever the user has at `~/.pi/agent/extensions/`).

If the bundle is missing (broken install / pre-bundling .vsix / failed extraction), the launcher loudly warns via `showWarningMessage` + logs missing paths to `console.error`, then falls back to `pi` on PATH so the user gets *some* response rather than silent failure. That fallback is unsupported — the fix is reinstalling the .vsix.

---

## 6. Behavior-preserving contracts

When refactoring, the following must stay invariant:

- **Webview IIFE entry**: `webview/main.ts` is the only entry; everything else is imported. `esbuild` produces one IIFE bundle.
- **DOM ids** (used by CSS + `getElementById`): `app`, `messages`, `topbar`, `prompt`, `send`, `btnNew`, `btnSessions`, `btnReset`, `btnSettings`, `btnAutoApprove`, `pickerMode`, `pickerModel`, `pickerThinking`, `ctxPill`, `popoverRoot`, `modalRoot`, `emptyState`, `recentList`.
- **CSS classes** that styles depend on: `message`, `bubble`, `user-bubble`, `assistant-bubble`, `system-bubble`, `status-row`, `tool-call`, `picker-chip`, `mode-chip`, `auto-approve`, `popover`, `modal-backdrop`, `question-card`, `session-list`, `session-tree`, `recent-row`, `recent-time`, `recent-id`, `todo-list`, `todo-item`, `diff`, `diff-line`, `diff-add`, `diff-del`, `diff-mark-old`, `diff-mark-new`, `file-link`, `plan-preview`, `plan-body`.
- **VS Code commands** (registered in `extension.ts`): `hmm-code.open`, `hmm-code.openInPanel`, `hmm-code.openSettings`, `hmm-code.cycleMode`, `hmm-code.toggleThinking`, `hmm-code.resetDefaults`, `hmm-code.abort`, `hmm-code.restartChat` (internal), `hmm-code.sendSlash` (internal).
- **Webview-view ID**: `hmm-code.chat`. Panel viewTypes: `hmm-code.chatPanel`, `hmm-code.settingsPanel`.
- **`STATUS_KEYS`** — must match Pi's set verbatim.
- **`finalize_plan` schema** — must match Pi's: `summary` + `body` + `steps` + `validation` + `docs?` + `target_mode?`.
- **Sidecar file name**: `.pi-modes-names.json` (kept for migration compatibility with the pre-rebrand pi-modes era).

---

## 7. Decision log

### Why DOMPurify on every markdown render
Without it, an LLM under prompt injection can return HTML containing `<img onerror>`, `<iframe>`, `javascript:` URLs, etc. CSP blocks inline scripts but not non-script vectors. DOMPurify centralizes the defense and the perf hit on streaming is negligible.

### Why no global VS Code keybindings
VS Code intercepts most modifier combos (`Ctrl+Shift+A` is a known one) before they reach the webview, so the `package.json` `keybindings` we tried never actually fired. Removed them rather than misleading the user — Command Palette + `keybindings.json` overrides are the honest path.

### Why bundle Pi inside the .vsix
Optimizes for first-time install — one click, no separate `npm install -g @earendil-works/pi-coding-agent`. Cost: .vsix grows by ~20 MB. We pin to a specific Pi version (`^0.77.0`) so user-side breakage from upstream changes is impossible. Dependabot opens PRs when Pi bumps.

### Why `process.execPath` + `ELECTRON_RUN_AS_NODE`
Lets the bundled Pi run on Electron's own Node — no system Node install required. Tested on macOS (arm64); Linux/Windows should work the same since Pi is pure JS at runtime.

### Why `--no-extensions -e ...`
Deterministic UX. If a user has their own `~/.pi/agent/extensions/hmm-code-pi/`, we'd double-register tools and Pi would error out. `--no-extensions` disables auto-discovery; `-e` explicitly loads the bundled extension. Their other Pi extensions still work from the terminal — just not in this VS Code panel.

### Why session names go to a sidecar file
Pi's session files are immutable. Storing user-given names in a sidecar (`.pi-modes-names.json`, indexed by session path) preserves Pi's invariant while letting the picker show meaningful labels.

---

## 8. Known gaps

- No automated test suite. Manual smoke-test checklist lives in [RELEASING.md](../RELEASING.md).
- Pre-existing `webview/tools.ts` implicit-any errors in three places — they don't affect runtime but show up in `tsc --noEmit`. Fixing requires adding parameter types to a few `Array.prototype.*` callbacks.
- Auto-approve has no audit log. When the toggle is on, every silent bypass is invisible. Consider an entry in Pi's session log if this becomes a problem.

---

## 9. Release flow

See [RELEASING.md](../RELEASING.md) — version bump → `git tag vX.Y.Z` → push → CI builds + creates a GitHub Release with the `.vsix` attached.

Dependabot weekly opens PRs for `@earendil-works/*` and the runtime deps (dompurify / marked / shiki). Merge → tag → release.

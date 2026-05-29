<div align="center">

<img src="media/icon.png" alt="Hmm-code" width="128" />

# Hmm-code

**A native VS Code UI for the [Pi coding agent](https://github.com/badlogic/pi-mono).**
plan / code / debug / ask modes · permission layer · AGENTS.md auto-injection · self-contained `.vsix`

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)
[![Release](https://img.shields.io/github/v/release/lbm1202/hmm-code-vscode?label=release)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![Pi-coding-agent](https://img.shields.io/badge/Pi-0.77.x-purple.svg)](https://github.com/badlogic/pi-mono)

[Install](#install) · [Features](#features) · [Docs](#docs) · [Companion Pi extension](https://github.com/lbm1202/hmm-code-pi)

</div>

---

> Drive a Pi coding agent session from a VS Code panel — mode-aware diffs, plan-first workflow, permission prompts, and session history without leaving your editor.

---

## Install

### From a release (recommended)

```bash
# Grab the latest .vsix from GitHub Releases
curl -L -o hmm-code.vsix \
  "$(curl -s https://api.github.com/repos/lbm1202/hmm-code-vscode/releases/latest \
     | grep browser_download_url | cut -d'"' -f4)"

# Install
code --install-extension hmm-code.vsix
```

Or browse <https://github.com/lbm1202/hmm-code-vscode/releases> and use VS Code's Extensions panel → `…` menu → **Install from VSIX…**

Then click the Hmm-code icon in the Activity Bar (or run "Hmm-code: Open Chat in Sidebar" from the Command Palette).

### Build from source
Clone both repos side by side (the build expects `hmm-code-pi` as a sibling of `hmm-code-vscode`):
```bash
git clone https://github.com/lbm1202/hmm-code-pi.git
git clone https://github.com/lbm1202/hmm-code-vscode.git
cd hmm-code-vscode
npm install
npm run build           # bundles Pi runtime + hmm-code-pi into out/vendor/
npx @vscode/vsce package
code --install-extension hmm-code-0.1.0.vsix --force
```

If the sibling isn't there, the build auto-clones `hmm-code-pi` into `node_modules/.cache/`. Override with `HMM_CODE_PI_PATH=/path/to/clone` to use an existing clone in any other location.

---

## Features

| | |
|---|---|
| 📦 **Self-contained `.vsix`** | Pi runtime + hmm-code-pi extension shipped together. One install, no separate Pi setup. |
| 🪟 **Sidebar + editor panels** | One sidebar view + N editor tabs. Each tab owns an independent Pi process. |
| 🔁 **Reload-survivable** | `WebviewPanelSerializer` + persisted `lastSessionFile` — VS Code reload returns to the last session. |
| 🎨 **Mode picker** | `code` (white) · `plan` (blue) · `debug` (purple) · `ask` (orange). Mirrors Pi's `setStatus`. |
| 🤖 **Model picker + aliases** | Aliases from `modes.json:modelAliases`. Per-mode filter. |
| 🃏 **Interactive tool cards** | Custom UI for `ask_user`, `todo_write`, `finalize_plan`, `request_mode_switch`. |
| 📝 **Edit / write diffs** | LCS-based unified diff with [Shiki](https://shiki.style/) syntax highlighting across 25+ languages. |
| 🖱️ **Ctrl/Cmd-click on file paths** | Tool-call paths open in the editor area. |
| 🔓 **Auto-approve toggle** | Session-scoped bypass for permission `ask` prompts (inline button). |
| 🛡️ **Permission confirm modal** | Pi's `ctx.ui.confirm` surfaced as a webview modal — UI for the Pi permission system. |
| ⚙️ **Settings panel** | Modes / models / filters / auth / custom providers — opens as an editor tab. |
| 🗂️ **Session picker** | Parent-child tree with rename + cascade delete. Active-session delete auto-spawns a replacement. |
| ✨ **Auto-generated titles** | First message pair → GPT-mini → session title (via the bundled Pi extension). |
| 🧼 **Sanitized markdown** | DOMPurify on every render — strips `<script>`, `on*` handlers, `javascript:` URLs, `<iframe>`. |

---

## Architecture

```
VS Code Extension Host (Node)
  ├── pi-launcher.ts             bundled vs user-override vs system pi
  ├── spawn `pi --mode rpc`      stdio JSONL framing
  │      ↑ bundled mode runs Electron's Node on out/vendor/pi/dist/cli.js
  │        with --no-extensions -e out/vendor/hmm-code-pi/index.ts
  ├── ChatViewProvider           sidebar webview
  ├── ChatPanel                  editor-area webview (serializer survives reload)
  ├── SettingsPanel              standalone editor tab
  └── ChatBackend                PiClient ↔ webview bridge
        ├── model-cache observers (settings panel auto-refresh)
        ├── restartAll()         respawn every Pi process (auth change)
        └── reloadAll()          /reload-runtime broadcast (modes/models change)

Webview  (14 modules)
  ├── dispatch          message router + Pi event handler
  ├── turn-lifecycle    status row + bubble + rAF-debounced markdown stream
  ├── tools             interactive cards + LCS diff + Shiki blocks
  ├── pickers           mode / model / thinking dropdowns
  ├── modals            question cards + confirm/input dialogs
  ├── session-picker    parent-child tree with rename / delete
  ├── history           past-message replay (alias-aware)
  ├── prompt            send / abort + key handlers (IME-safe)
  └── helpers/dom/state/protocol/types/syntax

Pi process (bundled)
  └── loads out/vendor/hmm-code-pi/index.ts via -e
        ├── plan / code / debug / ask mode system
        ├── tools: finalize_plan / request_mode_switch / ask_user / todo_write / auto-title
        ├── permissions layer (tool_call hook)
        └── AGENTS.md auto-injection (before_agent_start)
```

---

## Commands

Available from the Command Palette (`Cmd+Shift+P`) — no default keybindings (VS Code intercepts most modifier combos before they reach the webview). Bind your own via `keybindings.json` if you want shortcuts.

| Command | Description |
|---|---|
| `Hmm-code: Open Chat in Sidebar` | Focus the sidebar Chat view |
| `Hmm-code: New Chat Panel` | Open a new conversation in an editor tab |
| `Hmm-code: Open Settings` | Open the settings panel as an editor tab |
| `Hmm-code: Cycle Mode` | Equivalent to `/mode` |
| `Hmm-code: Toggle Thinking Level` | Equivalent to `/thinking-toggle` |
| `Hmm-code: Reset Model + Thinking to Mode Defaults` | Equivalent to `/reset` |
| `Hmm-code: Cancel Current Turn` | Abort the in-flight Pi response |

Inside the prompt textarea, `Tab` / `Shift+Tab` cycle modes (the webview handles these directly, no VS Code keybinding involved).

---

## Docs

| | |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | UI walkthrough of every feature |
| [docs/SETTINGS.md](docs/SETTINGS.md) | Settings panel reference |
| [docs/ANALYSIS.md](docs/ANALYSIS.md) | File-by-file architecture deep-dive |
| [RELEASING.md](RELEASING.md) | How to cut a release (maintainers) |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

Pi-side docs (workflow / permissions / AGENTS.md):
- [hmm-code-pi WORKFLOW](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/WORKFLOW.md)
- [hmm-code-pi PERMISSIONS](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/PERMISSIONS.md)
- [hmm-code-pi AGENTS-MD](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/AGENTS-MD.md)

---

## Layout

```
hmm-code-vscode/
├── src/
│   ├── extension.ts          activate() — launch config + view/panel/command registration
│   ├── pi-launcher.ts        bundled / user-override / system Pi decision
│   ├── chat-view.ts          sidebar WebviewView provider
│   ├── chat-panel.ts         editor-area WebviewPanel + serializer
│   ├── settings-panel.ts     standalone editor tab — modes / models / auth
│   ├── chat-backend.ts       PiClient ↔ webview bridge
│   ├── pi-client.ts          spawn pi --mode rpc, JSONL framing, EventEmitter
│   ├── protocol.ts           webview message kinds + STATUS_KEYS
│   ├── rpc-types.ts          Pi RPC type aliases
│   ├── oauth-codex.ts        OpenAI Codex OAuth flow
│   └── session-manager.ts    session enumeration + cascade delete
├── webview/                  14 modules — see Architecture above
├── .github/
│   ├── workflows/release.yml CI: tag push → build → release with .vsix attached
│   └── dependabot.yml        weekly @earendil-works + runtime dep update PRs
└── esbuild.config.mjs        extension + webview bundle + Pi vendor copy
```

---

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [Pi coding agent](https://github.com/badlogic/pi-mono) — the actual coding agent we wrap
- [Kilo Code](https://github.com/Kilo-Org/kilocode) — permission-rule patterns (MIT, used by the companion Pi extension)
- [Shiki](https://shiki.style/) — syntax highlighting
- [DOMPurify](https://github.com/cure53/DOMPurify) — markdown HTML sanitization
- [marked](https://marked.js.org/) — markdown rendering

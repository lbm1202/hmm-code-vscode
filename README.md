<div align="center">

<img src="media/icon.png" alt="Hmm-code" width="128" />

# Hmm-code

**A native VS Code UI for the [Pi coding agent](https://github.com/badlogic/pi-mono).**
plan / code / debug / ask modes · permission layer · AGENTS.md auto-injection · self-contained `.vsix`

[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)
[![Release](https://img.shields.io/github/v/release/lbm1202/hmm-code-vscode?label=release)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![Pi-coding-agent](https://img.shields.io/github/package-json/dependency-version/lbm1202/hmm-code-vscode/dev/@earendil-works/pi-coding-agent?label=Pi&color=purple)](https://github.com/badlogic/pi-mono)

**English** · [한국어](README.ko.md)

[Install](#install) · [What it does](#what-it-does) · [Docs](#docs) · [Pi extension](https://github.com/lbm1202/hmm-code-pi)

</div>

---

> ⚠️ **Beta.** Hmm-code is under active development — expect rough edges and occasional breaking changes between releases. Bug reports and feedback are very welcome.

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
code --install-extension "hmm-code-$(node -p "require('./package.json').version").vsix" --force
```

If the sibling isn't there, the build auto-clones `hmm-code-pi` into `node_modules/.cache/`. Override with `HMM_CODE_PI_PATH=/path/to/clone` to use an existing clone in any other location.

---

## What it does

A disciplined, mode-driven coding agent — the workflow, not the widgets:

- **Four explicit modes** — `plan` · `code` · `debug` · `ask`, each with its own model, thinking level, tools, and system prompt. Switch from the picker, or let the agent propose a switch you confirm.
- **Plan-first by design** — every code change goes `plan → code`. `plan`/`debug`/`ask` can't edit or write; only `code` touches your files, after a plan handoff (`finalize_plan`).
- **Permission-gated** — a layered permission system decides `allow` / `ask` / `deny` per tool call (mode defaults + `.piignore`), surfaced as confirm prompts. Session-scoped **auto-approve** when you want to move fast.
- **Dynamic compaction** — context auto-summarizes at the turn boundary instead of cutting the agent mid-turn (toggle + 50–85% threshold; manual **Compact** button).

The mode system, plan handoff, and permission layer come from the bundled [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) extension — this repo is the native VS Code UI for it.

## In the editor

Interactive tool cards · syntax-highlighted edit/write diffs ([Shiki](https://shiki.style/)) · **image attachments** (paste / file / drag-drop, shown as badges with a click-to-zoom lightbox) · a unified mode/model picker with an effort slider · permission modals · parent-child session history · tabbed settings panel (auth / models / modes / prompts) · English + Korean UI · self-contained `.vsix` (no separate Pi install).

> **Claude (Anthropic) subscription auth:** using a Claude Pro/Max plan with third-party agent tools like this one is officially supported by Anthropic from **2026-06-15** onward — see [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Before that date, prefer an Anthropic **API key** (or another provider). ChatGPT Plus/Pro (Codex) subscription auth is available via the OAuth button in the settings panel.

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

Webview  (15 modules)
  ├── dispatch          message router + Pi event handler
  ├── turn-lifecycle    status row + bubble + rAF-debounced markdown stream
  ├── tools             interactive cards + LCS diff + Shiki blocks
  ├── pickers           unified mode/model tabbed popover + effort slider
  ├── attachments       image paste / file picker / drag-drop + resize
  ├── modals            question cards + confirm/input dialogs
  ├── session-picker    parent-child tree with rename / delete
  ├── history           past-message replay (alias-aware)
  ├── prompt            send / abort + key handlers (IME-safe) + autosize
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

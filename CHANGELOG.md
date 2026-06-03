# Changelog

All notable changes to the Hmm-code VS Code extension are documented here.
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [SemVer](https://semver.org).

Releases are produced by `.github/workflows/release.yml` — push a `vX.Y.Z` tag and CI builds + publishes the `.vsix` to GitHub Releases.

## [Unreleased]

## [0.1.2] — 2026-06-04

Bundles Pi runtime + hmm-code-pi 0.1.2.

### Added
- **Image attachments.** Paste a screenshot, click the ＋ button, or drag-and-drop image files onto the prompt. Attachments are downscaled (longest edge ≤ 1568px), shown as removable thumbnail chips, echoed in the sent message, replayed from the on-disk transcript, and sent to the model as image parts. (Images load from `data:` URLs — the webview CSP allows `data:` but not `blob:`.)
- **Per-model image-input (vision) toggle** in the Models tab. Writes `input: ["text","image"]` to `models.json` (off writes `["text"]` explicitly). Pi replaces user images with a placeholder for models that don't declare image input, so this toggle is what lets attachments actually reach a vision-capable custom endpoint.
- **Full on-disk transcript with lazy windowing.** The chat renders the complete session transcript (read from the `.jsonl`) instead of only the compacted model context, so older turns no longer vanish after a compaction. A recent window loads first; an "↑ Load earlier messages" button prepends older chunks on demand (snapped to turn boundaries).
- **Include old tool outputs** toggle (General tab, default off). Off prunes tool outputs older than a recent window from the model context (the full output stays in the transcript) so context stays lean and compaction fires far less often; on keeps everything verbatim.

### Changed
- **Redesigned chat composer.** A single rounded, centered (~100-char) input that grows from one line to five then scrolls. Footer: ＋ / slash / compact / ctx on the left; mode / model / send (rounded-square buttons) on the right. The standalone model button is gone — the **mode button opens one tabbed popover** with a `[Mode | Model]` side toggle: *Mode* lists the modes (with icons + descriptions) plus an Auto-approve switch; *Model* lists models plus a sliding **Effort** slider (thinking level) pinned below the scrolling list. Selecting keeps the popover open, and mode/override status updates are debounced so the mode chip and Reset button don't flicker.
- **Reliable context compaction** + a boot READY handshake so session load / auto-resume fire deterministically. The webview drives compaction (built-in auto-compaction disabled) with a safety timeout that unlocks input if a compaction stalls.
- **Sky-blue rebrand** — empty-state logo, editor tab icon, and extension icon recolored from green to sky blue.
- Bundled **shiki 4.2.0** and **hmm-code-pi 0.1.2**.

### Fixed
- Stability hardening from an adversarial code review (HIGH/MED findings): drop unmatched RPC responses, add command timeouts, clear orphaned tool spinners, reset state on Pi EXIT, and gate auto-resume on readiness.
- Streaming output follows the bottom only when the view is pinned there — scrolling up to read no longer fights autoscroll.
- The resume / session-picker modal stays open while deleting sessions; the trash icon is centered.

## [0.1.1] — 2026-06-02

First stable on the 0.1.1 line (supersedes 0.1.1-rc1 / rc2). Bundles Pi runtime + hmm-code-pi 0.1.1.

### Added
- **Token usage modal.** Click the `ctx` pill in the chat footer to see per-model input/output token totals for the current session — aggregated across every session it spawned (a parent includes its children). Each assistant message carries its own model, so multi-model and branched sessions attribute correctly; a Total row appears when more than one model contributed.
- **Readable bash commands.** A `bash` tool-call summary only shows the truncated first line, so long or `&&`-chained / multi-line commands were unreadable. Expanding the block now shows the full command verbatim (wrapped), and Ctrl/Cmd-clicking the command (summary or block) opens the whole thing in a scratch editor tab — selectable, copyable, syntax-highlighted as shell.
- **Slash commands in the chat prompt.** Typing a registered command (`/mode`, `/reset`, `/compact`, …) now dispatches it cleanly — no stray user-message bubble and no stuck loading spinner — instead of being echoed and stranding the turn. A `/`-triggered autocomplete menu lists the available commands (fetched live from Pi via `get_commands`); click a suggestion to fill it in. Unknown slashes still go to the model as a normal message. (Keyboard navigation of the menu is not wired yet — mouse selection + Escape/click-outside to dismiss.)
  - `/plan-execute` is hidden from the menu: it's the TUI engine behind finalize_plan's new-session handoff, not a chat command (in VS Code the finalize_plan dialog is the entry point). It still clean-dispatches if typed in full.
  - The clean-dispatch path is race-proof: if the command list hasn't loaded yet on a cold session, a `/`-prefixed entry is still dispatched echo-free so it can't strand the spinner; the list is also re-fetched on session start when missing.

### Fixed
- A "waiting" status row (`응답 대기 중`) no longer lingers after a slash command that opens an interactive picker (bare `/mode`, `/mode-set`). The modal-answer handler optimistically started a turn status on every reply; for a picker that isn't part of a turn, nothing ever cleared it. It now refreshes the status only when a turn is actually in flight.

### Changed
- Compaction settings retuned: default auto-summarize threshold 75 → **70%**, and the threshold slider caps at **80%** with dynamic compaction on (the +10% grace band — also 15 → 10% — must stay under 100) or **90%** with it off. Toggling dynamic compaction adjusts the slider's max live.
- Bundled Pi runtime bumped to **0.78.0** (`@earendil-works/pi-coding-agent`).
- Internal: shared model alias + allowlist helpers extracted to `src/model-utils.ts`, used by both the chat backend and the settings webview so the chat picker and the settings dropdowns apply the same allowlist predicate. Added a `node --test` suite (`npm test`) and excluded `test/` from the packaged `.vsix`.
- CI: `.github/workflows/ci.yml` runs `tsc --noEmit` + `npm test` on every push and PR, plus a full bundle build to validate the contract guard.

## [0.1.1-rc2] — 2026-05-30

Pre-release (release candidate). Stable remains 0.1.0.

### Fixed
- Settings panel OAuth state now stays correct: the "✓ Authenticated" badge no longer disappears a few seconds after a successful login (a stale success-message timeout was wiping it), the login button is hidden while authenticated (disconnect from the auth table), and removing a Codex/Claude credential clears the badge and restores the button immediately instead of only after save + reload.

### Added
- **Prompts tab** in the settings panel. Consolidates all editable prompts in one place: the four mode system prompts (moved out of the Modes tab, which now holds model + thinking only), the **auto-title prompt** (full override of the built-in title prompt), and **compaction focus** (extra instructions appended to Pi's summary prompt — its base prompt can't be replaced). Empty = built-in default for each.
- **Dynamic compaction** toggle (General tab, on by default). When on, context compaction no longer interrupts the agent mid-turn — it summarizes at the turn boundary once usage passes the threshold, force-compacting only if usage climbs 15% past it. Turn it off for the legacy compact-on-threshold behavior. The threshold range is now 50–85% (the 15% grace band needs headroom under 100).
- Manual **Compact** button in the chat prompt footer — dispatches `/compact` to compact the session context on demand (same path as the Pi TUI `/compact`). Appears only once context usage reaches 20%.

### Changed
- Auto-compact watchdog raised to 10 min (bundled Pi) so a slow-but-working compaction on a reasoning model isn't prematurely re-armed.
- Session titles are generated in the `hmm-code.language` locale (passed to Pi as `HMM_CODE_LANG`), and auto-title no longer fires on a turn that's also compacting (avoids a duplicate request to the session model).
- Internal: the settings-panel webview script was converted from plain JS to TypeScript and split into modules (`settings-state` / `settings-disk` / `settings-pickers` / `settings-codex` + core); the host↔webview protocol constants are single-sourced (`src/protocol-shared.ts`); and the whole extension now type-checks with zero errors (the old `webview/tools.ts` implicit-any filter is gone).

## [0.1.1-rc1] — 2026-05-29

Pre-release (release candidate). Stable remains 0.1.0.

### Added
- **Internationalization (i18n).** UI strings externalized to `l10n/{en,ko}.json` (+ `package.nls{,.ko}.json` for commands). English is the source/default; Korean ships as a locale. New `hmm-code.language` setting (`auto`/`en`/`ko`) — `auto` follows VS Code's display language.
- **Tabbed settings panel** — General / Authentication / Models / Modes. Custom providers now live under Authentication.
- **Per-mode system-prompt editor** in the Modes tab. Defaults are read from the bundled Pi `config.ts`; saving the unchanged default writes no override.
- **`hmm-code.autoApproveDefault`** — start new/resumed sessions with permission auto-approve ON.
- **Configurable context auto-summarization threshold** (General tab) — writes `modes.json:autoCompactThreshold`; default is the bundled Pi `AUTO_COMPACT_THRESHOLD`.
- **Summary (compaction) model** picker (General tab) — choose a dedicated model to summarize context during compaction; empty = the active session model. Writes `modes.json:compactModel`.
- **Codex usage readout** (Authentication tab) — shows the 5-hour and weekly ChatGPT-subscription limit usage (% used + reset time + plan), fetched read-only with the stored Codex OAuth token. Auto-loads when Codex is authenticated; refreshable.
- OAuth login buttons (Codex / Claude) disable and show "✓ Authenticated" once that provider has an OAuth credential.
- `LICENSE` (MIT), `CHANGELOG.md`, `RELEASING.md`.

### Changed
- READMEs and `docs/*` translated to English and updated for the bundled-`.vsix` install flow.
- Internal cleanup — removed dead exports, deduped helpers (`escapeHtml`, `ansi24`), demoted internal-only `export`s.
- Switched from `--skip-license` packaging to a real LICENSE file.

### Fixed
- Session-picker badge now counts all descendant sessions (children + grandchildren), not just direct children.

### Removed
- `hmm-code.piBinary` setting — single-distribution Pi only. Bundle is always used; if missing the .vsix is broken, not a config opportunity.

## [0.1.0] — 2026-05-29

First public release.

### Added
- Self-contained `.vsix` — bundles Pi runtime + hmm-code-pi extension. Single install, no separate Pi setup required.
- `hmm-code.piBinary` setting — point at an external Pi binary for power users.
- Sidebar `WebviewView` + editor-area `WebviewPanel` (multiple independent chats).
- Plan / code / debug / ask mode picker mirroring Pi's `setStatus`.
- Model + thinking pickers with `modes.json:modelAliases` support and per-mode override visibility (`Alt+X → default`).
- Interactive tool cards: `ask_user` (with multiselect), `todo_write`, `finalize_plan`, `request_mode_switch`.
- Edit / write LCS diffs with Shiki syntax highlighting (25+ languages).
- Read-result Shiki highlighting based on file extension.
- Ctrl/Cmd-click on tool-call file paths to open in the editor.
- Auto-approve toggle (inline button — session-scoped).
- Permission confirm modal mirroring Pi's `ctx.ui.confirm`.
- Standalone Settings panel — modes / models / auth / custom providers.
- Session picker with parent-child tree, rename + cascade delete, auto-spawn replacement when active session is deleted.
- Auto-resume after window reload via `WebviewPanelSerializer` + persisted last-session.
- Auto-generated session titles (via the bundled Pi extension).
- DOMPurify on every markdown render — blocks `<img onerror>`, `<iframe>`, `javascript:` URLs, etc.
- `Hmm-code` output channel logging launch source + extension path.
- GitHub Actions release workflow + Dependabot for `@earendil-works/*` and runtime deps.

### Fixed
- Auto-resume race: switch_session now guarded so the in-flight target session can't be overwritten by an interim STATE for Pi's temp session.
- Plan handoff race: mode-switch wait is now condition-based (`waitFor(ui.mode === target, 2000)`) instead of a fixed 200ms.

[Unreleased]: https://github.com/lbm1202/hmm-code-vscode/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/lbm1202/hmm-code-vscode/compare/v0.1.1-rc2...v0.1.1
[0.1.1-rc2]: https://github.com/lbm1202/hmm-code-vscode/compare/v0.1.1-rc1...v0.1.1-rc2
[0.1.1-rc1]: https://github.com/lbm1202/hmm-code-vscode/compare/v0.1.0...v0.1.1-rc1
[0.1.0]: https://github.com/lbm1202/hmm-code-vscode/releases/tag/v0.1.0

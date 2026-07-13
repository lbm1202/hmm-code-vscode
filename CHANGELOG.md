# Changelog

All notable changes to the Hmm-code VS Code extension are documented here.
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [SemVer](https://semver.org).

Releases are produced by `.github/workflows/release.yml` — push a `vX.Y.Z` tag and CI builds + publishes the `.vsix` to GitHub Releases.

## [Unreleased]

### Fixed
- **Usage checks no longer fail with "HTTP 401 (token expired)".** When the stored OAuth access token has expired, the usage lookup now asks the running Pi to refresh it first (an AuthStorage key-resolve — no LLM turn, no chat pollution; Pi stays the single writer of auth.json), then fetches. Applies to the topbar usage modal and both settings-panel usage buttons, for Claude and Codex.

### Changed
- **Model pickers in the settings panel are a single dropdown now.** The Modes tab (and the auto-title / compaction model overrides) drop the separate provider select — every model is listed in one dropdown grouped by provider, and picking a model sets its provider implicitly. Previously the model list stayed empty until a provider was chosen.

## [0.1.12] — 2026-07-13

Bundles Pi runtime 0.80.6 + hmm-code-pi 0.1.10.

### ✨ Highlights
- **Subscription usage at a glance — and Codex is back.** A new ％ button in the topbar opens a plan-usage modal for every connected subscription: Claude Pro/Max (session 5h / weekly / extra credits) and ChatGPT Codex (5h / weekly, plan name) as gauge bars with reset times. The ChatGPT Plus/Pro (Codex) browser login returns to the settings Auth tab.
- **Pi runtime 0.80.6.** Brings the Claude Sonnet 5 and GPT-5.6 model catalogs, the new `max` thinking level (exposed on the Effort slider for models that support it), provider fixes, and security updates — up from 0.79.1.
- **Cleaner chrome.** Monochrome topbar glyphs (＋ ☰ ％ ⚙︎) that follow the editor theme, styled hover cards on every topbar button, and a mode-chip hover card showing the live model + effort without opening the popover.

### Added
- **Topbar subscription-usage button.** Sits between the session and settings buttons; opens a modal showing plan usage for every connected subscription — Claude Pro/Max (session 5h / weekly / extra-usage credits) and ChatGPT Codex (5h / weekly, plan name) — as the same gauge bars the token modal uses, with reset times. Fetched fresh on every open; read-only.
- **Mode chip hover card.** Hovering the composer's mode button shows a styled card — mode name in the mode color, plus live Model and Effort rows — so the active model is visible without opening the popover. (A custom card, not the native tooltip: the OS one has a long delay and skips after clicks, which made it look broken.)
- **OpenAI Codex subscription login restored.** The settings Auth tab regains the ChatGPT Plus/Pro row (browser OAuth login, cancel, per-plan usage check) that 0.1.11 removed. Credentials land in `auth.json[openai-codex]` in the shape Pi's AuthStorage refreshes natively.
- **`max` thinking level.** The Effort slider, settings-panel thinking dropdowns, and mode configs accept the new top level for models that declare it (adaptive Claude models, GPT-5.6). Shown only when the model's `thinkingLevelMap` explicitly maps it — same gating as `xhigh`.

### Changed
- **Topbar icons are monochrome now.** The sessions and usage buttons swap their color-emoji glyphs (🕘 📊) for plain text symbols (☰ list, ％ percent; the gear gets an explicit text-presentation selector), so all four buttons render in the editor foreground color.
- **Bundled Pi runtime updated 0.79.1 → 0.80.6.** Notable upstream changes: Claude Sonnet 5 + GPT-5.6 model catalogs, `max` thinking level, per-message reasoning-token usage reporting, compaction fixes (post-compaction token budgeting, custom-entry ordering during streaming, split-turn summary serialization), `get_entries`/`get_tree` RPC commands, and security updates to vulnerable transitive dependencies (undici, protobufjs).
- Dependency updates: dompurify 3.4.10 → 3.4.12, shiki 4.2.0 → 4.3.1, marked 18.0.5 → 18.0.6.
- Build tooling: esbuild 0.24.2 → 0.28.1 (clears the GHSA-67mh-4wv8-2f99 dev-server advisory; identical bundle output, `npm audit` now clean).

## [0.1.11] — 2026-07-13

Bundles Pi runtime 0.79.1 + hmm-code-pi 0.1.9.

### ✨ Highlights
- **Review mode closes the loop: plan → code → review.** Implementation sessions can now hand their work to a dedicated review mode that verifies the result against the plan — reading the changed files, checking the plan's pinned contracts, and actually running the plan's validation commands — then reports PASS or a findings list. A failed review can launch a fix round with one call, re-entering the loop.
- **Mid-turn steering.** Type while the model is working: your message is queued and delivered at the next tool boundary, so you can redirect the agent without aborting.
- **Reasoning & response insights.** The thinking header animates while the model reasons and settles to "Thought for N.Ns"; every response ends with a copy button and a stats toggle (tokens, time-to-first-token, generation speed, total time) that survive reloads.

### Added
- **Review mode + implementation→review handoff.** The mode picker gains a 5th `review` mode (eye icon, green). When a plan-handoff implementation session completes (`finalize_implementation`), a dialog asks what to do next — hand off to review, continue implementing, or not now. On review, the chat switches back to the parent plan session, enters review mode, and asks it to verify the implementation: read the changed files, check the plan's pinned contracts, run the plan's validation commands, then report PASS or a findings list and stop — the user decides whether to launch a fix round (review can call `finalize_plan` directly, re-entering the code→review loop). Once the review reply lands, the session automatically returns to the mode it was in before the handoff (a manual `/mode review` stays sticky). Sessions without a recorded parent review in place. The `finalize_implementation` tool call renders a summary card (changes / validation results / deviations) like the plan preview.
- **Mid-turn steering.** The prompt no longer locks while the model is working: type and press Enter to queue a message that Pi delivers at the next tool boundary, letting you redirect the agent without aborting. Queued messages render dimmed (dashed outline) until delivered; the send button still doubles as Stop. Slash commands, the Tab mode-cycle, and the mode popover stay blocked mid-turn (a mode/model change wouldn't apply to the already-running loop while the permission layer would flip immediately).
- **Animated thinking header + reasoning time.** The reasoning block gets a sparkle icon that pulses while the model reasons, a label that animates ("Thinking." → ".." → "…") and settles to "Thought for N.Ns", and a chevron pinned to the right that rotates on open/close.
- **Per-message actions: copy + stats.** Each assistant message ends with a right-aligned icon row — a copy-response button (with copied feedback) and a stats toggle that expands to a breakdown: prompt tokens (with cached share), generated tokens, thinking time, time-to-first-token, generation speed (tok/s), and total time. Token counts use abbreviated units (3.1k tokens). Tokens come from Pi's usage report; timings are measured client-side and persisted into the session transcript itself, so the display survives reloads and travels with the session file. Sessions recorded before this feature replay without timings.
- **Input-wait notifications.** When Pi is waiting on a dialog answer (finalize dialogs, ask_user, confirmations) and the chat is not on screen, a toast ("Hmm-code is waiting for your input" with an Open Chat button) and an activity-bar badge on the Hmm-code icon appear; both clear once you answer or open the chat.
- **Claude subscription usage check.** The settings Auth tab's Claude Pro/Max row gains a "Check usage" button showing the session (5h) and weekly windows as percent bars with reset times, plus extra-usage credits when enabled.
- **Plan & report retention setting.** New "Plan & report retention" field in the settings panel (General tab): plan files and implementation reports older than N days are deleted automatically at session start (default 30, 0 = keep forever).
- **Default mode setting.** New "Default mode" select in the settings panel (General tab): the mode a NEW session starts in (default `code`; writes `modes.json:defaultMode`). Existing sessions still reopen in their last-used mode.
- **Localized dialogs.** The finalize-plan / finalize-implementation choice dialogs, their input prompts, and the mode-switch confirmation now follow the UI language (Korean when `hmm-code.language` is Korean).

### Changed
- **Plan-handoff sessions are titled by what they build.** Implementation child sessions used to get near-identical auto-titles (their first message is always the same handoff boilerplate); the auto-titler now feeds the plan's own Summary section to the title model instead, so each child gets a distinct, meaningful name.
- **Auto-approve on session start moved into the settings panel** (General tab, stored in `modes.json:autoApproveDefault`); the `hmm-code.autoApproveDefault` VS Code setting is gone.
- The thinking block sits on a slightly lighter background so it reads as its own surface inside the bubble.

### Fixed
- **Failed interactive tool calls now show the actual error.** A schema-rejected `finalize_plan` / `ask_user` call used to render a bare "?" in its result line; it now shows the validation error text so you can see what the model got wrong (these errors are self-recovered on the model's retry).
- **Diff view horizontal scroll.** Red/green row backgrounds no longer cut off at the old viewport edge when scrolling long lines sideways, and the file-path header stays pinned while scrolling.

### Removed
- **OpenAI Codex subscription login** (and its usage check) — removed from the settings Auth tab. API-key auth is unaffected.

## [0.1.10] — 2026-07-03

Bundles Pi runtime 0.79.1 + hmm-code-pi 0.1.8.

### ✨ Highlights
- **The `edit` tool now auto-corrects shifted indentation.** Weak / local models often get the code right but author an edit's `oldText` at the wrong indent depth (e.g. 8 spaces when the file uses 4). The exact-match edit then failed and the model fell back to opaque shell writes. Edits now reconcile a whole-block indentation shift against the file and apply at the file's real indent — language-agnostic (spaces or tabs; Python, JS, Java, Go, …).
- **Readable hint when an edit can't be matched.** The result now shows the file's actual bytes near the closest line with whitespace made visible (`·` space, `→` tab), so the model self-corrects instead of shelling out.
- **Fixed chat scroll freezing** during streamed responses.

### Added
- **Structural-whitespace-tolerant `edit` reconciliation.** An indentation-shifted `oldText` is located by dedent-anchored matching (relative structure is preserved and verified), and on a unique match it's rewritten to the file's exact bytes with `newText` re-indented to the file's level. Conservative by design: it bails on ambiguous matches or tab/space mismatches rather than risk editing the wrong place.
- **Visible-whitespace edit failure hint** showing the closest file region with `·`/`→` and any duplicate candidate locations.

### Changed
- **Removed the `Session ID` line from the system prompt** — it was informational only and nothing read it back.

### Fixed
- **Chat scroll froze mid-response.** Auto-scroll now tracks the rendered height after the debounced markdown render (both text and thinking blocks) instead of scrolling before the DOM grew.
- **Korean (IME) input on iPad / code-server:** pressing Shift+Enter while a Hangul syllable was still composing duplicated the syllable and swallowed the line break (e.g. `안녀` + Shift+Enter → `안녀녀`). The newline is now left to the browser's native handling, which composes correctly, with a fallback for webviews that eat the keystroke.

## [0.1.9] — 2026-06-12

Bundles Pi runtime 0.79.1 + hmm-code-pi 0.1.7.

### ✨ Highlights
- **Pi runtime updated to 0.79.1** — adds Claude Fable 5 (Anthropic / Bedrock) plus a stack of provider and `models.json` fixes.
- **Workspace folders stay trusted.** Pi 0.79 added a trust gate before loading project-local `.pi/` resources; Hmm-code now trusts the folder you opened, so project settings/skills keep loading without a prompt.
- **Marketplace-first install docs** — install with `ext install lbm1202.hmm-code`.

### Changed
- **Bundled Pi runtime 0.78.0 → 0.79.1.** Upstream highlights: Claude Fable 5, project-trust gating for project-local settings / resources / instructions / packages, `models.json` schema + OpenAI Responses custom-provider handling fixes (`compat.supportsDeveloperRole: false`), and neutral wording in the compaction summary prompt.
- **Launch the bundled Pi with `--approve`** so project-local `.pi/` resources load under 0.79's new trust gate — in headless RPC there is no prompt to answer, so an unapproved project would otherwise silently skip them. Hmm-code's own AGENTS.md injection and permission rules are read directly and were never affected.
- **Install docs now lead with the VS Code Marketplace** (`ext install lbm1202.hmm-code`); the `.vsix` download stays documented for code-server / VSCodium / Cursor (Open VSX), where Hmm-code is not published.

## [0.1.8] — 2026-06-12

Bundles Pi runtime + hmm-code-pi 0.1.7.

### Changed
- Dependency updates: `dompurify` 3.4.7 → 3.4.10, `marked` 18.0.4 → 18.0.5.

## [0.1.7] — 2026-06-12

Bundles Pi runtime + hmm-code-pi 0.1.7.

### Changed
- The agent's system prompt now includes the active session id (Pi).

## [0.1.6] — 2026-06-08

Bundles Pi runtime + hmm-code-pi 0.1.6.

### ✨ Highlights
- **Pinned task list** — when the agent works a `todo_write` checklist, it's pinned to the top of the chat and updated live (the in-stream block collapses to one line); a **Done** button clears it once everything is complete.
- **Tool-call status dots** — green for success, red for failure; failed calls now collapse (click to expand).
- **Cache-stable context** — tool-output pruning is now *sticky*, so the prompt cache stops thrashing on long, tool-heavy sessions, and the agent can auto-continue the remaining tasks after a turn-boundary compaction.

### Added
- **Tool-call status dots.** Every finished tool call shows a green (success) / red (failure) dot on its summary line. On failure the result block now collapses — only the red dot shows, click to expand; success keeps the existing long-output auto-collapse.
- **Pinned task-list panel** (default on). When the agent uses the task-list tool, the full list is pinned to the top of the chat and updated live, while the in-stream block collapses to a one-line summary; a **Done** button appears once every task is complete and dismisses the panel (a later incomplete update re-shows it). The panel re-seeds from history on reload. Toggle in **settings → General** ("Pin task list to the top"); off → the full list renders inline as before.
- **Continue-after-auto-compaction toggle** (settings → General, default on) for the Pi extension's new auto-continue behavior — resume the remaining tasks after a turn-boundary auto-compaction.

### Changed
- **Tool-output pruning is now sticky** (Pi). The kept-verbatim window no longer re-slides every request, so the prompt cache stops thrashing on tool-heavy, high-context turns (roughly one cache break per prune batch instead of one per tool turn). The keep-floor + batch size auto-derive from the model's context window and the auto-compact threshold.

## [0.1.5] — 2026-06-05

Bundles Pi runtime + hmm-code-pi 0.1.5.

### ✨ Highlights
- **Floating composer** — the input box overlays the message list, so the full-width chat shows on both sides of (and scrolls behind) the narrower input, like Claude Code.
- **Context-window awareness** — auto-detect each model's window from `/v1/models`, a gauge in the token-usage modal, and a `ctx %` that updates the moment you switch model or mode.

### Added
- **Context-window auto-detection** (settings → Models). Discovering models now also reads each model's context window from the same `/v1/models` response (vLLM/omlx `max_model_len`, LM Studio `max_context_length`, `context_length`, …) and pre-fills `contextWindow` when a discovered model is added. A per-provider **Detect context** button backfills `contextWindow` for already-added models the same way. Servers that don't report a size (plain OpenAI, vanilla mlx_lm.server) are left untouched. Keeps the chat `ctx %` and auto-compaction accurate without hand-editing models.json.
- **Context-window gauge** in the token-usage modal (click the `ctx` pill). Shows the current model's context fill as a bar — used / max tokens + percent — that turns amber past 70% (auto-compact zone) and red past 90%.

### Changed
- **Floating composer.** The input box now overlays the message list (anchored to the bottom) instead of taking its own full-width row, so the full-width chat shows on both sides of — and scrolls behind — the narrower input, like Claude Code. The message list reserves a matching bottom space (tracked live as the composer grows / wraps) so the last message stays clear of the input.
- The **manual Compact button** now appears once context usage reaches **35%** (was 20%).
- **`ctx %` updates on a model / mode switch** (Pi). The context percentage now reflects the new model's window immediately on a switch, instead of staying stale until the next assistant response.

### Fixed
- **Loading-dots animation reset.** The "thinking" status row was re-appended to the DOM on every stream delta (to keep it pinned at the bottom), which restarted its CSS animation — so the dots flickered back to frame 0 on each chunk. It now only re-pins when something new was actually appended after it.
- **Auto-corrected `edit` tool calls with a misplaced `path`** (Pi). Local models sometimes nest `path` inside an `edits[]` entry instead of at the top level, failing schema validation; the call is now normalized (path hoisted) before validation so it succeeds on the first try.

## [0.1.4] — 2026-06-04

First release published to the **VS Code Marketplace** — the extension is in **beta** (noted on the README / listing). No functional changes from 0.1.3; this release adds Marketplace listing metadata and CI publishing. Bundles Pi runtime + hmm-code-pi 0.1.3.

### Changed
- The release workflow now also publishes the built `.vsix` to the **VS Code Marketplace** (`vsce publish`) and **Open VSX** (`ovsx publish`) — both opt-in, gated on a clean tag + the matching token secret, so releases keep working until the secrets are set. Polished the Marketplace listing metadata (categories, keywords, gallery banner, bugs/homepage). See RELEASING.md for one-time setup.

## [0.1.3] — 2026-06-04

Bundles Pi runtime + hmm-code-pi 0.1.3.

### ✨ Highlights
- **Image attachments now show as compact badges** (thumbnail + filename + dimensions) and open a fullscreen lightbox on click, instead of large inline thumbnails.
- **Composer polish** — a per-mode glyph on the mode button, a divider above the toolbar, and a footer that collapses cleanly to icons on narrow panels.

### Added
- **Image-attachment badges + lightbox.** Attached images render as a compact badge — thumbnail + filename + W×H dimensions (dimensions inline in gray; a long filename ellipsizes rather than pushing them out) — in both the composer strip and sent user bubbles. Clicking a badge opens a fullscreen preview (dark backdrop, close button, click-outside / `Esc` to dismiss). Filenames come from the picked/dropped file, or a mime-derived default for pasted/replayed images.
- **Mode-button glyph.** The mode button shows a per-mode icon (code `</>`, plan, debug, ask) beside the label, matching the mode popover.

### Changed
- **Composer refinements.** No resting border/fill on the mode button (hover shows the hit-area); a divider line between the input and the toolbar row; the ctx pill height aligned to the ＋/ buttons; the input column narrowed to ~90ch with a comfortable side gutter on narrow panels.
- **Compact footer at narrow widths.** At ≤340px the footer collapses to one row — mode button → icon only, ctx pill → "%" only, reset → "↺" only — and otherwise wraps the right-hand group to a second line instead of cramming.
- **Session picker opens instantly.** Clicking the history button opens the picker immediately — the cached list right away, or a loading spinner if nothing is cached yet — then refreshes in place when enumeration completes, instead of waiting on a fixed delay.
- Internal: the release workflow now composes the GitHub Release body from this CHANGELOG's matching version section (single source of truth — see RELEASING.md).

### Fixed
- **Shift+Enter scrolls the caret into view.** Because the newline is inserted manually (the native keystroke is unreliable in SSH-remote webviews), the browser's caret-into-view scroll was lost, so a new line past the 5-line max stayed hidden until the next keystroke.
- **Stale editor-tab title.** Deleting the active session (or switching to a fresh/unnamed one) left the tab showing the gone session's name. The title now resets to the default when the active session has no name — driven authoritatively from session state, and reset immediately when a new session is spawned after a delete.

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

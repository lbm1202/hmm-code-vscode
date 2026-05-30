# Settings panel reference

Open via `Cmd+Shift+P` → "Hmm-code: Open Settings" or the ⚙ button in the chat footer.

The panel opens in its own editor tab. Every change is staged in-memory and committed by the **Save** button in the bottom-right. Dirty cards get an emphasized border.

Saving triggers an auto-reload — auth changes respawn every Pi process (`restartAll`), while modes/models-only changes broadcast `/reload-runtime` (`reloadAll`). All chat tabs pick up the new config instantly.

---

The panel has **five tabs**: General · Authentication · Models · Modes · Prompts. The sections below group the controls by tab.

---

## Modes tab

Edit the model + thinking level for each of the four modes (plan / code / debug / ask). The per-mode **system prompts** live in the **Prompts** tab.

| Mode  | Provider ▾ | Model ▾ | Thinking ▾ |
|-------|-----------|---------|------------|
| plan  | …         | …       | …          |
| code  | …         | …       | …          |
| debug | …         | …       | …          |
| ask   | …         | …       | …          |

### Provider dropdown
- `(default)` — use the mode default
- Every registered provider (Pi built-ins + custom providers)

### Model dropdown
- Models for the selected provider
- **Aliases show as the primary label** — e.g. `Hmm` (raw id `Qwen3.6-35B-A3B-MLX-VL-oQ5`)
- The raw id appears in the hover tooltip
- **Filter-aware** — models hidden by the per-provider model filter don't show here, *except* the currently selected one (`modelOptionsHtml` injects `currentValue` so you can see what's set)

### Thinking dropdown
- Only the levels the model supports (per its `thinkingLevelMap`)
- `(default)` = mode default

---

## General tab

### UI language
`hmm-code.language` (`auto` / `en` / `ko`) — `auto` follows VS Code's display language. Changing it prompts a window reload. Also exposed as a native VS Code setting.

### Auto-title model
The model used to generate session titles in the background (`auto-title.ts`).

- **Empty**: falls back through the GPT-mini candidate list → code mode's model → the currently active model.
- **Set**: that model is used unconditionally (saved as `modes.json:autoTitle.{provider,id}`).

### Context auto-summarization
When usage reaches the **threshold** (slider, 50–85%; default 75%, stored as `modes.json:autoCompactThreshold`), the conversation is summarized (compacted) to free room.

- **Dynamic compaction** (toggle, on by default — `modes.json:dynamicCompaction`): compaction waits for the agent's multi-step turn to finish (the turn boundary) instead of cutting it mid-loop; it only force-compacts mid-turn if usage climbs 15% past the threshold. Off = legacy behavior (compact the moment the threshold is crossed, even mid-turn).
- **Summary (compaction) model** (`modes.json:compactModel`): the model that writes the compaction summary. **Empty = the active session model.** Set a dedicated (cheaper/faster) model to offload summarization off your chat model.

---

## Prompts tab

Every editable prompt in one place. Empty = built-in default for each.

- **Mode system prompts** — the per-mode `systemPromptAddendum` (plan / code / debug / ask), appended to the base system prompt. Saving text identical to the default writes no override. (`modes.json:modes.<mode>.systemPromptAddendum`)
- **Auto-title prompt** — replaces the built-in title prompt; the language line (from `hmm-code.language`) is always appended regardless. (`modes.json:autoTitlePrompt`)
- **Compaction focus** — extra instructions appended to Pi's summary prompt as `Additional focus: …` (Pi's base summary prompt can't be replaced). Empty = none. (`modes.json:compactInstructions`)

---

## Models tab — per-provider model filter

Allowlists which models appear in the chat model picker.

One card per provider — header shows the name + `N / M visible` + **All** / **None** buttons. Body is a checkbox grid of every model in that provider.

| Card | Model checkboxes |
|---|---|
| **Custom-Provider** (1 / 1 visible) | ☑ ModelA |
| **openai** (1 / 4 visible) | ☐ gpt-4o-mini · ☐ o1 · ☐ o1-mini · ☑ gpt-4o |

### State semantics

| State | Result |
|---|---|
| All checked | No filter — every model visible (key is removed entirely from `modes.json`) |
| Some checked | Only those models appear in the picker and mode dropdowns |
| None checked | Zero models visible for this provider (explicitly saved as `[]` — "hide all") |

The All / None buttons toggle the whole card.

### Where the filter applies

- ✅ Chat model picker
- ✅ Settings panel's mode model dropdowns
- ✅ Settings panel's auto-title dropdown
- ❌ The filter UI itself (otherwise you couldn't re-enable a model after hiding it)

Already-selected hidden models persist in the dropdowns — `modelOptionsHtml` injects `currentValue` so you can still see what's set.

Storage: `modelAllowlist` field in `~/.pi/agent/modes.json`. Missing key = no filter (everything visible).

---

## Authentication tab — provider auth (`auth.json`)

UI for Pi's `AuthStorage` (`~/.pi/agent/auth.json`).

### Add an API key
- Enter the provider id (e.g. `openai`, `anthropic`, `groq`) + API key.
- Click "Add" — staged immediately in the in-memory draft, persisted on Save.
- Inline — no modal pops up.

### OAuth login (Codex / Claude)
- "Codex login" / "Claude login" buttons → start the browser OAuth flow.
- On success every Pi process restarts (refreshes the in-memory `auth.json` cache); the login button is hidden and a green **✓ Authenticated** badge shows. Removing the credential restores the button.
- Cancelable mid-flow (abort button).

### Codex usage
When Codex is authenticated, a read-only readout shows the 5-hour and weekly ChatGPT-subscription limit usage (% used + reset time + plan). Auto-loads on this tab; refreshable. Fetched with the stored OAuth token — nothing is written.

### Removal
- The ✕ button on each row.

### Security
- API key VALUEs are never sent to the webview — only the type (`api_key` / `oauth`).
- The on-disk file is written with `0600` permissions.

---

## Models tab — custom providers (`models.json`)

Register vLLM / Ollama / self-hosted OpenAI-compatible endpoints.

The top **+ Add provider** button creates a new card. Inside each card:

- **baseUrl** — endpoint (e.g. `https://api.example.com/v1`)
- **apiKey** — API key (masked on display)
- **api** — API kind (`openai-completions` / `anthropic-messages` etc.)
- **Models table** — each row: `#` · `ID` · `name (alias)` · `reasoning` checkbox · `✕` remove
- Bottom actions: **+ Add manually** / **Discover models** (auto-detect)

### Adding a provider
- Click "+ Add provider" → new card with a placeholder name.
- Fill in `baseUrl` + `apiKey` + `api` (e.g. `openai-completions`).

### Model row fields
| Field | Meaning |
|---|---|
| ID | Model id (required) — the provider's actual model name |
| Name | Alias / friendly label (e.g. "ModelA"). Blank = no alias. |
| Reasoning | Check if the model supports reasoning/thinking. Toggling saves `"reasoning": true` to `models.json`. |
| ✕ | Remove the row. |

**The model name IS the alias** — it's what shows in the chat picker and mode dropdowns. There's no separate alias UI (an older version had one — removed; `model.name` is the single source of truth).

### Discover models (auto-discovery)
- "Discover models" button → calls `${baseUrl}/models` (OpenAI-compatible).
- The response ids show as checkboxes.
- Bulk-select supported — already-registered models are pre-checked.
- "Add" → registers the selected models (default `reasoning=false`).

Storage: `~/.pi/agent/models.json`.

---

## Save behavior in detail

The Save button (fixed bottom-right bar) appears only when something is dirty.

```
Save (3 modes · auto-title model · model filter)  [Save]
```

Internal flow:
1. `models.json` first (aliases derived from custom models feed into `modes.json:modelAliases`).
2. Collect those aliases and write `modes.json` — mode configs (incl. system prompts) + autoTitle + autoTitlePrompt + modelAllowlist + autoCompactThreshold + dynamicCompaction + compactModel + compactInstructions, all at once.
3. Apply the `auth.json` delta (adds + removes).
4. Route:
   - **Auth changed** → `restartChat` (`ChatBackend.restartAll`) — respawn every Pi process.
   - **Modes / models only** → `ChatBackend.reloadAll()` — broadcasts `/reload-runtime` to every backend + auto-pulls fresh model list ~800 ms later.
5. Every chat tab picks up the new config instantly.

A toast confirms the save and lists the touched files (`modes.json`, `models.json`, `auth.json`).

---

## Cache / sync

- **Model cache**: `ChatBackend._cachedModels` (static field) — shared across every chat tab + settings panel; populated whenever any backend fetches.
- **Settings observer**: when the cache updates, the settings panel auto-refreshes its dropdowns. The settings panel can open before any chat has run.
- **First-open auto-fetch**: if the cache is empty when the settings panel opens, it asks the first live backend for models — the observer fires and the dropdowns populate moments later.

---

## Troubleshooting

### Save didn't take effect in chat
- Modes/models-only changes go through `/reload-runtime` — Pi stays alive and re-reads config files.
- If a newly registered model doesn't appear, Pi's `modelRegistry.refresh()` is called on `session_start(reason="reload")` — if that doesn't fire, restart the chat tab (↺ button).

### Codex login completed but no models
- A successful login triggers `restartChat` → every Pi process restarts → new auth surfaces the codex models.
- If nothing appears, run "Developer: Reload Window".

### Settings model dropdown is empty
- Likely no chat has run yet — open a chat tab once to trigger an auto-fetch.
- Or the cache-observer raced — reopen the settings panel.

### Auto-title model change isn't applied
- Check `modes.json` directly: `cat ~/.pi/agent/modes.json | jq .autoTitle`.
- Empty → the fallback chain applies (GPT-mini candidates → code mode's model → active model).

### Custom provider isn't recognized
- Confirm the `baseUrl` responds with an OpenAI-compatible `/models` endpoint (`{ data: [{id, ...}] }`) for discovery.
- Without an API key, both discovery and use fail.

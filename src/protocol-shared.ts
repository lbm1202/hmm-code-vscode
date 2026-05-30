// Single source of truth for the host ↔ webview message-kind + status
// constants. Re-exported by both src/protocol.ts and webview/protocol.ts so the
// two bundles can never drift (previously these three objects were duplicated
// by hand and "kept in sync by convention"). Pure string constants — esbuild
// inlines them into each bundle; nothing here loads host-only code, so it is
// safe in the webview bundle too.
//
// Every kind is referenced in BOTH the webview's dispatch switch and the host's
// handleFromWebview switch. Constants give us autocomplete + grep-ability and,
// now, a compile-time guarantee that both sides agree on the strings.

/** A registered slash command surfaced to the prompt autocomplete. Mirrors the
 *  shape Pi's `get_commands` RPC returns. `source: "extension"` commands run a
 *  handler with no LLM turn (clean-dispatch, no chat echo); `skill`/`prompt`
 *  expand into a message to the model. */
export interface SlashCommand {
	name: string;
	description: string;
	source: "extension" | "skill" | "prompt";
}

/** kind values on ToWebview (host → webview). */
export const TO_WEBVIEW = {
	READY: "ready",
	EVENT: "event",
	UI_REQUEST: "ui-request",
	UI_HINT: "ui-hint",
	STATE: "state",
	SESSIONS: "sessions",
	MODELS: "models",
	MESSAGES: "messages",
	/** Registered slash commands (from Pi's get_commands RPC) for the prompt
	 *  autocomplete + clean-dispatch path. */
	COMMANDS: "commands",
	STDERR: "stderr",
	EXIT: "exit",
} as const;

/** kind values on FromWebview (webview → host). */
export const FROM_WEBVIEW = {
	PROMPT: "prompt",
	ABORT: "abort",
	UI_RESPONSE: "ui-response",
	COMMAND: "command",
	REQUEST_STATE: "request-state",
	REQUEST_MODELS: "request-models",
	REQUEST_MESSAGES: "request-messages",
	REQUEST_CONTEXT: "request-context",
	/** Ask the host for the registered slash command list (get_commands RPC). */
	REQUEST_COMMANDS: "request-commands",
	LIST_SESSIONS: "list-sessions",
	DELETE_SESSION: "delete-session",
	RENAME_SESSION: "rename-session",
	/** Open the standalone settings panel. Host executes hmm-code.openSettings. */
	OPEN_SETTINGS: "open-settings",
	/** Ctrl/Cmd-click on a file path in a tool summary/header. Host opens the
	 *  file in the editor area (no-op for non-existent paths). */
	OPEN_FILE: "open-file",
	/** Inline slash command — bypasses the user-message echo path so a button
	 *  click doesn't litter the chat with /commands. Host forwards directly to
	 *  Pi via prompt/no-reply. */
	SLASH: "slash",
} as const;

/** setStatus keys we receive from Pi modes ext (and synthesize ourselves).
 *  Mirrors hmm-code-pi/constants.ts:STATUS_KEYS — the build's contract guard
 *  asserts every Pi key is present here. */
export const STATUS_KEYS = {
	MODE: "mode",
	MODEL: "model",
	THINKING: "thinking",
	OVERRIDDEN: "overridden",
	CONTEXT: "context",
	PLAN_HANDOFF: "plan-handoff",
	// Pi emits this from todo_write. The webview currently renders todos from
	// the todo_write tool-call result, not this setStatus channel — mirrored
	// here only to keep the contract complete with Pi's constants.ts.
	TODOS: "todos",
	AUTO_APPROVE: "auto-approve",
} as const;

// Shared message kind constants for the host ↔ webview channel.
// Mirrored in webview/protocol.ts (same string values — keep in sync).
//
// Why constants: every kind is referenced in BOTH the webview's dispatch
// switch and the host's handleFromWebview switch. Adding a kind in only one
// place silently breaks the other; constants give us autocomplete + grep.

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
	STDERR: "stderr",
	EXIT: "exit",
} as const;
export type ToWebviewKind = (typeof TO_WEBVIEW)[keyof typeof TO_WEBVIEW];

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
	LIST_SESSIONS: "list-sessions",
	DELETE_SESSION: "delete-session",
	RENAME_SESSION: "rename-session",
	OPEN_SETTINGS: "open-settings",
} as const;
export type FromWebviewKind = (typeof FROM_WEBVIEW)[keyof typeof FROM_WEBVIEW];

/** setStatus keys we receive from Pi modes ext (and synthesize ourselves). */
export const STATUS_KEYS = {
	MODE: "mode",
	MODEL: "model",
	THINKING: "thinking",
	OVERRIDDEN: "overridden",
	CONTEXT: "context",
	PLAN_HANDOFF: "plan-handoff",
	TODOS: "todos",
} as const;

/** Pi RPC commands that imply we should resync get_state and emit session_start. */
export const SESSION_RESET_COMMANDS = new Set<string>([
	"new_session",
	"switch_session",
	"fork",
	"clone",
]);

// Mirror of src/protocol.ts — kept in sync by convention.
// Webview is a separate bundle so it can't import from src/; duplicating the
// string constants here gives us autocomplete + grep-ability on both sides.

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
	/** Open the standalone settings panel. Host executes hmm-code.openSettings. */
	OPEN_SETTINGS: "open-settings",
	/** Ctrl/Cmd-click on a file path in a tool summary/header → open in editor. */
	OPEN_FILE: "open-file",
} as const;

export const STATUS_KEYS = {
	MODE: "mode",
	MODEL: "model",
	THINKING: "thinking",
	OVERRIDDEN: "overridden",
	CONTEXT: "context",
	PLAN_HANDOFF: "plan-handoff",
	TODOS: "todos",
} as const;

export const PI_EVENT = {
	MESSAGE_START: "message_start",
	MESSAGE_UPDATE: "message_update",
	MESSAGE_END: "message_end",
	SESSION_START: "session_start",
	SESSION_SWITCH: "session_switch",
	SESSION_LOADED: "session_loaded",
	TOOL_EXEC_START: "tool_execution_start",
	TOOL_EXEC_UPDATE: "tool_execution_update",
	TOOL_EXEC_END: "tool_execution_end",
	AGENT_START: "agent_start",
	AGENT_END: "agent_end",
	TURN_START: "turn_start",
	TURN_END: "turn_end",
	EXTENSION_ERROR: "extension_error",
	SESSION_INFO_CHANGED: "session_info_changed",
} as const;

export const ASSISTANT_DELTA = {
	TEXT: "text_delta",
	THINKING: "thinking_delta",
	TOOLCALL_END: "toolcall_end",
} as const;

export const MODE_NAMES = ["code", "plan", "debug", "ask"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Models whose thinking surface is binary (on/off) at the protocol level. */
export const BINARY_THINKING_FORMATS = new Set(["qwen-chat-template", "qwen", "zai"]);

export const MODE_COLORS: Record<string, string> = {
	code: "rgb(240, 240, 240)",
	plan: "rgb(100, 150, 255)",
	debug: "rgb(180, 120, 220)",
	ask: "rgb(255, 165, 80)",
};

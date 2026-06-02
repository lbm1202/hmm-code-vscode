// Webview-side protocol surface. The shared host ↔ webview kind/status
// constants live in src/protocol-shared.ts and are re-exported here so existing
// `./protocol` imports keep working — esbuild inlines them into the webview
// bundle at build time (the file is pure constants, so the "webview can't load
// host code at runtime" rule doesn't apply). Webview-only additions live below.

export { TO_WEBVIEW, FROM_WEBVIEW, STATUS_KEYS } from "../src/protocol-shared";
export type { SlashCommand } from "../src/protocol-shared";

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

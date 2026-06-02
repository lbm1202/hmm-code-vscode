// Pi RPC protocol types. Verified against the installed Pi at
// /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts.
// Wire format: JSONL over stdio (LF-only, no other line breaks).

// ── Stdin: commands client → Pi ──────────────────────────────────────────────
export interface RpcCommandBase {
	id?: string;
	type: string;
}

export interface RpcCmdPrompt extends RpcCommandBase {
	type: "prompt";
	message: string;
	images?: unknown[];
	streamingBehavior?: "steer" | "followUp";
}
export interface RpcCmdSteer extends RpcCommandBase { type: "steer"; message: string }
export interface RpcCmdFollowUp extends RpcCommandBase { type: "follow_up"; message: string }
export interface RpcCmdAbort extends RpcCommandBase { type: "abort" }
export interface RpcCmdGetState extends RpcCommandBase { type: "get_state" }
export interface RpcCmdSetModel extends RpcCommandBase { type: "set_model"; provider: string; modelId: string }
export interface RpcCmdSetThinking extends RpcCommandBase {
	type: "set_thinking_level";
	level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
export interface RpcCmdCompact extends RpcCommandBase { type: "compact" }
/** Toggle Pi's BUILT-IN auto-compaction. We disable it (enabled:false) at
 *  spawn so the hmm-code-pi extension is the sole compaction authority — see
 *  chat-backend.ts:start(). Without this, Pi's built-in fires at its own
 *  reserveTokens threshold and collides with our extension-driven compaction
 *  ("Compaction cancelled"). Pi persists this to ~/.pi/settings.json. */
export interface RpcCmdSetAutoCompaction extends RpcCommandBase { type: "set_auto_compaction"; enabled: boolean }
export interface RpcCmdGetCommands extends RpcCommandBase { type: "get_commands" }
export interface RpcCmdGetMessages extends RpcCommandBase { type: "get_messages" }
export interface RpcCmdGetAvailableModels extends RpcCommandBase { type: "get_available_models" }
export interface RpcCmdNewSession extends RpcCommandBase { type: "new_session"; reason?: string }

export type RpcCommand =
	| RpcCmdPrompt
	| RpcCmdSteer
	| RpcCmdFollowUp
	| RpcCmdAbort
	| RpcCmdGetState
	| RpcCmdSetModel
	| RpcCmdSetThinking
	| RpcCmdCompact
	| RpcCmdSetAutoCompaction
	| RpcCmdGetCommands
	| RpcCmdGetMessages
	| RpcCmdGetAvailableModels
	| RpcCmdNewSession
	| (RpcCommandBase & { type: string; [k: string]: unknown });

// Extension UI responses (client → Pi). Three shapes by method:
// - select/input/editor: { value: string } or { cancelled: true }
// - confirm: { confirmed: boolean } or { cancelled: true }
export type RpcExtensionUiResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ── Stdout: messages Pi → client ─────────────────────────────────────────────

// Command responses
export interface RpcResponseOk {
	id?: string;
	type: "response";
	command: string;
	success: true;
	data?: unknown;
}
export interface RpcResponseErr {
	id?: string;
	type: "response";
	command: string;
	success: false;
	error: string;
}
export type RpcResponse = RpcResponseOk | RpcResponseErr;

// Extension UI requests — Pi forwards extension ctx.ui.* calls
export type RpcExtensionUiRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
	| { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

/** Methods that require a response back from the client. */
export const RESPONDING_METHODS = new Set([
	"select",
	"confirm",
	"input",
	"editor",
]);

// Lifecycle / streaming events — Pi forwards SessionEvents as-is. The exact
// union is large; we type loosely and special-case the events we render.
export interface RpcEvent {
	type: string;
	[k: string]: unknown;
}

export type IncomingMessage = RpcResponse | RpcExtensionUiRequest | RpcEvent;

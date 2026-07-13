// Webview-side type definitions. Kept structurally compatible with
// src/chat-backend.ts (the host sends these as plain JSON over postMessage,
// so structural equivalence is all that matters).

import type {
	FROM_WEBVIEW,
	SlashCommand,
	TO_WEBVIEW,
} from "./protocol";

export type SessionEntry = {
	file: string;
	name: string;
	mtimeMs: number;
	parentFile?: string;
	preview?: string;
};

export type ModelEntry = {
	provider: string;
	id: string;
	/** User alias from modes.json:modelAliases (attached by ChatBackend). */
	alias?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	compat?: { thinkingFormat?: string; [k: string]: unknown };
	[k: string]: unknown;
};

export type UiResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

export type ToWebview =
	| { kind: typeof TO_WEBVIEW.EVENT; event: any }
	| { kind: typeof TO_WEBVIEW.UI_REQUEST; req: any }
	| { kind: typeof TO_WEBVIEW.UI_HINT; hint: any }
	| { kind: typeof TO_WEBVIEW.STDERR; text: string }
	| { kind: typeof TO_WEBVIEW.EXIT; code: number | null; signal: string | null }
	| { kind: typeof TO_WEBVIEW.STATE; state: any }
	| { kind: typeof TO_WEBVIEW.SESSIONS; sessions: SessionEntry[] }
	| {
			kind: typeof TO_WEBVIEW.MESSAGES;
			messages: unknown[];
			stats?: Record<string, MsgTimings>;
	  }
	| { kind: typeof TO_WEBVIEW.MODELS; models: ModelEntry[] }
	| { kind: typeof TO_WEBVIEW.COMMANDS; commands: SlashCommand[] }
	| {
			kind: typeof TO_WEBVIEW.USAGE;
			perModel: Record<string, { input: number; output: number }>;
			sessionCount: number;
			context?: { tokens: number; contextWindow: number; percent: number };
	  }
	| { kind: typeof TO_WEBVIEW.READY };

export type FromWebview =
	| { kind: typeof FROM_WEBVIEW.PROMPT; text: string }
	| { kind: typeof FROM_WEBVIEW.STEER; text: string }
	| { kind: typeof FROM_WEBVIEW.ABORT }
	| { kind: typeof FROM_WEBVIEW.UI_RESPONSE; response: UiResponse }
	| { kind: typeof FROM_WEBVIEW.COMMAND; command: { type: string; [k: string]: unknown } }
	| { kind: typeof FROM_WEBVIEW.REQUEST_STATE }
	| { kind: typeof FROM_WEBVIEW.REQUEST_MODELS }
	| { kind: typeof FROM_WEBVIEW.REQUEST_MESSAGES }
	| { kind: typeof FROM_WEBVIEW.REQUEST_CONTEXT }
	| { kind: typeof FROM_WEBVIEW.REQUEST_COMMANDS }
	| { kind: typeof FROM_WEBVIEW.LIST_SESSIONS }
	| { kind: typeof FROM_WEBVIEW.DELETE_SESSION; file: string }
	| { kind: typeof FROM_WEBVIEW.RENAME_SESSION; file: string; name: string }
	| { kind: typeof FROM_WEBVIEW.OPEN_SETTINGS }
	| { kind: typeof FROM_WEBVIEW.OPEN_FILE; path: string }
	| { kind: typeof FROM_WEBVIEW.OPEN_TEXT; text: string; language?: string }
	| { kind: typeof FROM_WEBVIEW.REQUEST_USAGE; file: string };

export type StatusState = {
	row: HTMLElement;
	textEl: HTMLElement;
	timer: number;
};

/** Webview-measured per-message timings. Persisted into the session transcript
 *  (webview-stats custom entry via /stats-record) and restored on replay. */
export interface MsgTimings {
	ttftMs: number;
	genMs: number;
	totalMs: number;
	thinkMs: number;
}

export type BubbleState = {
	bubble: HTMLElement;
	textEl: HTMLElement;
	thinkingEl: HTMLElement | null;
	toolsEl: HTMLElement | null;
	text: string;
	thinking: string;
	/** rAF id pending a markdown re-render; null when no render is queued. */
	pendingRender: number | null;
	/** rAF id pending a thinking re-render. */
	pendingThinkingRender: number | null;
	/** When the API request behind this message started (runtime.requestMarkAt
	 *  captured at bubble creation) — basis for ttft/total in the stats line. */
	requestStartAt: number;
	/** First streamed delta for this message (bubble creation time). */
	firstDeltaAt: number;
	/** First/last thinking delta timestamps (null = no thinking yet). */
	thinkingStartAt: number | null;
	thinkingEndAt: number | null;
	/** The thinking <summary> element + its dots-animation interval id. */
	thinkingSummaryEl: HTMLElement | null;
	thinkingAnim: number | null;
};

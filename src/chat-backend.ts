import * as vscode from "vscode";
import { PiClient } from "./pi-client";
import {
	FROM_WEBVIEW,
	STATUS_KEYS,
	SESSION_RESET_COMMANDS,
	TO_WEBVIEW,
} from "./protocol";
import {
	deleteSession,
	listSessions,
	renameSession,
	type SessionEntry,
} from "./session-manager";
import type { RpcEvent, RpcExtensionUiRequest, RpcExtensionUiResponse } from "./rpc-types";

export interface ModelEntry {
	provider: string;
	id: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	compat?: { thinkingFormat?: string; [k: string]: unknown };
	thinkingLevels?: string[]; // legacy convenience; unused if thinkingLevelMap present
	[k: string]: unknown;
}

export type { SessionEntry } from "./session-manager";

export type ToWebview =
	| { kind: typeof TO_WEBVIEW.EVENT; event: RpcEvent }
	| { kind: typeof TO_WEBVIEW.UI_REQUEST; req: RpcExtensionUiRequest }
	| { kind: typeof TO_WEBVIEW.UI_HINT; hint: RpcExtensionUiRequest }
	| { kind: typeof TO_WEBVIEW.STDERR; text: string }
	| { kind: typeof TO_WEBVIEW.EXIT; code: number | null; signal: string | null }
	| { kind: typeof TO_WEBVIEW.STATE; state: unknown }
	| { kind: typeof TO_WEBVIEW.SESSIONS; sessions: SessionEntry[] }
	| { kind: typeof TO_WEBVIEW.MODELS; models: ModelEntry[] }
	| { kind: typeof TO_WEBVIEW.MESSAGES; messages: unknown[] }
	| { kind: typeof TO_WEBVIEW.READY };

export type FromWebview =
	| { kind: typeof FROM_WEBVIEW.PROMPT; text: string }
	| { kind: typeof FROM_WEBVIEW.ABORT }
	| { kind: typeof FROM_WEBVIEW.UI_RESPONSE; response: RpcExtensionUiResponse }
	| { kind: typeof FROM_WEBVIEW.COMMAND; command: { type: string; [k: string]: unknown } }
	| { kind: typeof FROM_WEBVIEW.REQUEST_STATE }
	| { kind: typeof FROM_WEBVIEW.REQUEST_MODELS }
	| { kind: typeof FROM_WEBVIEW.REQUEST_MESSAGES }
	| { kind: typeof FROM_WEBVIEW.REQUEST_CONTEXT }
	| { kind: typeof FROM_WEBVIEW.LIST_SESSIONS }
	| { kind: typeof FROM_WEBVIEW.DELETE_SESSION; file: string }
	| { kind: typeof FROM_WEBVIEW.RENAME_SESSION; file: string; name: string }
	| { kind: typeof FROM_WEBVIEW.OPEN_SETTINGS };

export interface ChatBackendOpts {
	/** Fires when Pi reports a session name change (initial load or rename). */
	onSessionName?: (name: string) => void;
}

/**
 * One chat session: owns a PiClient + handles webview ↔ RPC bridging.
 * Used by both the sidebar WebviewView (ChatViewProvider) and editor-area
 * WebviewPanels (ChatPanel). Each instance spawns its own `pi --mode rpc`
 * process, so opening multiple panels = multiple independent sessions.
 */
export class ChatBackend {
	private client: PiClient | undefined;
	private disposed = false;
	private cwd: string | undefined;
	/** Cache of get_available_models latest response — populated whenever the
	 *  sidebar/panel pulls models. Settings panel reads this via the static
	 *  accessor to populate provider/model dropdowns without needing its own
	 *  Pi connection. */
	private static _cachedModels: ModelEntry[] = [];
	static cachedModels(): ModelEntry[] {
		return ChatBackend._cachedModels;
	}

	constructor(
		private readonly webview: vscode.Webview,
		private readonly opts: ChatBackendOpts = {},
	) {
		webview.onDidReceiveMessage((raw: FromWebview) => this.handleFromWebview(raw));
	}

	private notifySessionName(name: unknown): void {
		if (typeof name === "string" && name.trim()) {
			this.opts.onSessionName?.(name);
		}
	}

	start(cwd: string | undefined): void {
		if (this.client || this.disposed) return;
		this.cwd = cwd;
		const c = new PiClient();
		c.on("event", (ev: RpcEvent) => {
			// Side-channel: Pi emits session_info_changed when setSessionName is
			// called (including by our auto-title generator). Forward to host.
			if ((ev as any)?.type === "session_info_changed") {
				this.notifySessionName((ev as any).name);
			}
			this.post({ kind: TO_WEBVIEW.EVENT, event: ev });
		});
		c.on("ui-request", (req: RpcExtensionUiRequest) =>
			this.post({ kind: TO_WEBVIEW.UI_REQUEST, req }),
		);
		c.on("ui-hint", (hint: RpcExtensionUiRequest) =>
			this.post({ kind: TO_WEBVIEW.UI_HINT, hint }),
		);
		c.on("stderr", (text: string) => {
			// Suppress only the routine success log ("[auto-title] using ..."),
			// so error/diagnostic lines stay visible for troubleshooting.
			const filtered = text
				.split(/\r?\n/)
				.filter((line) => !/^\s*\[auto-title\] using\s/.test(line))
				.join("\n");
			if (filtered.trim()) this.post({ kind: TO_WEBVIEW.STDERR, text: filtered });
		});
		c.on("exit", (info: { code: number | null; signal: string | null }) =>
			this.post({ kind: TO_WEBVIEW.EXIT, code: info.code, signal: info.signal }),
		);
		c.on("error", (err: Error) =>
			this.post({ kind: TO_WEBVIEW.STDERR, text: `[pi error] ${err.message}` }),
		);
		c.on("parse-error", (info: { line: string; err: Error }) =>
			this.post({
				kind: TO_WEBVIEW.STDERR,
				text: `[parse error] ${info.err.message}\n  line: ${info.line.slice(0, 200)}`,
			}),
		);
		try {
			c.start({ cwd });
			this.client = c;
			this.post({ kind: TO_WEBVIEW.READY });
		} catch (err) {
			this.post({ kind: TO_WEBVIEW.STDERR, text: `Failed to spawn pi: ${(err as Error).message}` });
		}
	}

	dispose(): void {
		this.disposed = true;
		this.client?.stop();
		this.client = undefined;
	}

	/** Tear down the live Pi process and spawn a fresh one. Used by the
	 *  settings panel after auth changes — Pi's `ctx.reload()` doesn't
	 *  refresh AuthStorage, so a full process restart is the reliable
	 *  way to pick up auth.json edits (e.g. removing openai-codex).
	 *  The webview's persisted lastSessionFile triggers auto switch_session
	 *  on the new ready event, so the user lands back on the same chat. */
	restart(): void {
		if (this.disposed) return;
		this.client?.stop();
		this.client = undefined;
		// Tiny delay so the previous process fully exits before we spawn
		// the next one (avoids transient log noise from overlapping starts).
		setTimeout(() => {
			if (this.disposed) return;
			this.start(this.cwd);
		}, 100);
	}

	abort(): void {
		this.client?.sendNoReply({ type: "abort" });
	}

	prompt(slashCommand: string): void {
		this.client?.sendNoReply({ type: "prompt", message: slashCommand });
	}

	private post(msg: ToWebview): void {
		if (this.disposed) return;
		this.webview.postMessage(msg);
	}

	private workspaceCwd(): string {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? "";
	}

	private async refreshSessions(): Promise<void> {
		this.post({ kind: TO_WEBVIEW.SESSIONS, sessions: listSessions(this.workspaceCwd()) });
	}

	private async resyncStateAfterCommand(): Promise<void> {
		const client = this.client;
		if (!client) return;
		try {
			const stateRes = await client.send({ type: "get_state" });
			if (stateRes.success) {
				this.post({ kind: TO_WEBVIEW.STATE, state: stateRes.data });
				this.notifySessionName((stateRes.data as any)?.sessionName);
			}
		} catch (err) {
			console.error("[hmm-code:chat-backend] resync get_state failed:", err);
		}
	}

	private async handleFromWebview(raw: FromWebview): Promise<void> {
		const client = this.client;
		if (!client) return;
		switch (raw.kind) {
			case FROM_WEBVIEW.PROMPT:
				try {
					await client.send({ type: "prompt", message: raw.text });
				} catch (err) {
					this.post({ kind: TO_WEBVIEW.STDERR, text: `prompt failed: ${(err as Error).message}` });
				}
				return;
			case FROM_WEBVIEW.ABORT:
				client.sendNoReply({ type: "abort" });
				return;
			case FROM_WEBVIEW.UI_RESPONSE:
				client.sendUiResponse(raw.response);
				return;
			case FROM_WEBVIEW.COMMAND: {
				const cmd = raw.command;
				try {
					const res = await client.send(cmd as any, 60_000);
					if (!res.success) {
						this.post({ kind: TO_WEBVIEW.STDERR, text: `${cmd.type} failed: ${res.error}` });
						return;
					}
					if (SESSION_RESET_COMMANDS.has(cmd.type)) {
						const data = res.data as { cancelled?: boolean } | undefined;
						// session_start isn't delivered to RPC subscribers, so we
						// synthesize one for the webview to clear/reload the view.
						if (!data?.cancelled) {
							this.post({
								kind: TO_WEBVIEW.EVENT,
								event: { type: "session_start", reason: cmd.type },
							});
						}
					}
					// Many command responses (set_model, set_thinking_level, cycle_*)
					// return the changed object itself, not a state shape. The webview's
					// renderState needs the full state, so always re-pull.
					await this.resyncStateAfterCommand();
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `${cmd.type} error: ${(err as Error).message}`,
					});
				}
				return;
			}
			case FROM_WEBVIEW.REQUEST_STATE:
				try {
					const res = await client.send({ type: "get_state" });
					if (res.success) {
						this.post({ kind: TO_WEBVIEW.STATE, state: res.data });
						this.notifySessionName((res.data as any)?.sessionName);
					}
				} catch (err) {
					this.post({ kind: TO_WEBVIEW.STDERR, text: `get_state failed: ${(err as Error).message}` });
				}
				return;
			case FROM_WEBVIEW.LIST_SESSIONS:
				await this.refreshSessions();
				return;
			case FROM_WEBVIEW.DELETE_SESSION:
				try {
					deleteSession(raw.file, this.workspaceCwd());
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `delete-session failed: ${(err as Error).message}`,
					});
				}
				await this.refreshSessions();
				return;
			case FROM_WEBVIEW.RENAME_SESSION:
				try {
					renameSession(raw.file, raw.name);
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `rename-session failed: ${(err as Error).message}`,
					});
				}
				await this.refreshSessions();
				return;
			case FROM_WEBVIEW.OPEN_SETTINGS:
				vscode.commands.executeCommand("hmm-code.openSettings");
				return;
			case FROM_WEBVIEW.REQUEST_MESSAGES:
				try {
					const res = await client.send({ type: "get_messages" });
					if (res.success) {
						const data = res.data as { messages?: unknown[] };
						this.post({ kind: TO_WEBVIEW.MESSAGES, messages: data.messages ?? [] });
					}
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `get_messages failed: ${(err as Error).message}`,
					});
				}
				return;
			case FROM_WEBVIEW.REQUEST_CONTEXT:
				try {
					const res = await client.send({ type: "get_session_stats" });
					if (res.success) {
						const data = res.data as { contextUsage?: { percent?: number } };
						const usage = data.contextUsage;
						if (usage && typeof usage.percent === "number") {
							this.post({
								kind: TO_WEBVIEW.UI_HINT,
								hint: {
									type: "extension_ui_request",
									id: "synthetic-context",
									method: "setStatus",
									statusKey: STATUS_KEYS.CONTEXT,
									statusText: `${usage.percent.toFixed(1)}%`,
								} as any,
							});
						}
					}
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `get_session_stats failed: ${(err as Error).message}`,
					});
				}
				return;
			case FROM_WEBVIEW.REQUEST_MODELS:
				try {
					const res = await client.send({ type: "get_available_models" });
					if (res.success) {
						// Pass through full models (incl. thinkingLevelMap, reasoning,
						// compat) so the webview can compute supported thinking levels
						// even when state.model is incomplete.
						const data = res.data as { models?: any[] };
						const models = (data.models ?? []) as ModelEntry[];
						ChatBackend._cachedModels = models;
						this.post({ kind: TO_WEBVIEW.MODELS, models });
					}
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `get_available_models failed: ${(err as Error).message}`,
					});
				}
				return;
		}
	}
}

// ── Shared HTML renderer + helpers ──────────────────────────────────────────

export interface RenderInfo {
	version: string;
	publisher: string;
}

export function renderChatHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	info: RenderInfo,
): string {
	const nonce = makeNonce();
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "out", "webview", "main.js"),
	);
	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "out", "webview", "styles.css"),
	);
	const csp = [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} data:`,
	].join("; ");
	// Inject version/publisher BEFORE the main script loads so dom.ts can
	// read them when building the empty-state HTML. JSON.stringify escapes
	// any quotes/control chars so it's safe inside a <script>.
	const infoLiteral = JSON.stringify(info);
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Hmm-code</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">window.__HMM_INFO = ${infoLiteral};</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
	let out = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
	return out;
}

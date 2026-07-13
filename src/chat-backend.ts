import * as vscode from "vscode";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiClient } from "./pi-client";
import type { PiLaunchConfig } from "./pi-launcher";
import { getWebviewMessages, resolveLocale, t } from "./i18n";
import {
	FROM_WEBVIEW,
	STATUS_KEYS,
	SESSION_RESET_COMMANDS,
	TO_WEBVIEW,
	type SlashCommand,
} from "./protocol";
import {
	collectCascade,
	deleteSession,
	listSessions,
	readSessionMessages,
	readSessionStats,
	renameSession,
	subtreeUsage,
	type ModelUsage,
	type SessionEntry,
} from "./session-manager";
import type { RpcEvent, RpcExtensionUiRequest, RpcExtensionUiResponse } from "./rpc-types";
import { buildCsp, jsonForScript, makeNonce } from "./webview-html";
import { applyAllowlist, findAlias } from "./model-utils";
import { collectSubscriptionUsage, type SubUsageEntry } from "./sub-usage";

const MODES_JSON_PATH = join(homedir(), ".pi", "agent", "modes.json");

/** Read modes.json once and return the two maps the model post-processing
 *  needs. Empty maps on any error (file missing, parse failure, etc) so
 *  callers don't need to special-case the absent-file path. */
function readModelMaps(): {
	aliases: Record<string, string>;
	allowlist: Record<string, string[]>;
} {
	try {
		if (!existsSync(MODES_JSON_PATH)) return { aliases: {}, allowlist: {} };
		const raw = JSON.parse(readFileSync(MODES_JSON_PATH, "utf-8")) as {
			modelAliases?: Record<string, string>;
			modelAllowlist?: Record<string, string[]>;
		};
		return {
			aliases: raw?.modelAliases ?? {},
			allowlist: raw?.modelAllowlist ?? {},
		};
	} catch {
		return { aliases: {}, allowlist: {} };
	}
}

/** modes.json `todoPanel` flag (default ON) for the chat webview's pinned todo
 *  panel. Read from modes.json (a settings-panel field), not vscode config;
 *  injected into __HMM_CFG. True unless explicitly set false. */
function readTodoPanel(): boolean {
	try {
		if (!existsSync(MODES_JSON_PATH)) return true;
		const raw = JSON.parse(readFileSync(MODES_JSON_PATH, "utf-8")) as { todoPanel?: boolean };
		return raw?.todoPanel !== false;
	} catch {
		return true;
	}
}

/** modes.json:autoApproveDefault (default OFF). When true, dispatch.ts sends
 *  `/auto-approve on` on session start. Configured in the settings panel. */
function readAutoApproveDefault(): boolean {
	try {
		if (!existsSync(MODES_JSON_PATH)) return false;
		const raw = JSON.parse(readFileSync(MODES_JSON_PATH, "utf-8")) as { autoApproveDefault?: boolean };
		return raw?.autoApproveDefault === true;
	} catch {
		return false;
	}
}

/** Attach aliases to a raw Pi model list — used for the static cache that
 *  feeds the settings panel (which wants ALL models, no allowlist filter). */
function attachAliases(raw: ModelEntry[], aliases: Record<string, string>): ModelEntry[] {
	return raw.map((m) => {
		const alias = findAlias(aliases, m.provider, m.id);
		return alias ? { ...m, alias } : m;
	});
}

export interface ModelEntry {
	provider: string;
	id: string;
	/** User-defined alias from modes.json:modelAliases. Attached by
	 *  ChatBackend when caching/posting; not present on raw Pi responses. */
	alias?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	compat?: { thinkingFormat?: string; [k: string]: unknown };
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
	| {
			kind: typeof TO_WEBVIEW.MESSAGES;
			messages: unknown[];
			stats?: Record<string, { ttftMs: number; genMs: number; totalMs: number; thinkMs: number }>;
	  }
	| { kind: typeof TO_WEBVIEW.COMMANDS; commands: SlashCommand[] }
	| {
			kind: typeof TO_WEBVIEW.USAGE;
			perModel: Record<string, ModelUsage>;
			sessionCount: number;
			context?: { tokens: number; contextWindow: number; percent: number };
	  }
	| { kind: typeof TO_WEBVIEW.SUB_USAGE; token?: number; entries: SubUsageEntry[] }
	| { kind: typeof TO_WEBVIEW.READY };

export type FromWebview =
	| { kind: typeof FROM_WEBVIEW.PROMPT; text: string; images?: { type: "image"; data: string; mimeType: string }[] }
	| { kind: typeof FROM_WEBVIEW.STEER; text: string; images?: { type: "image"; data: string; mimeType: string }[] }
	| { kind: typeof FROM_WEBVIEW.ABORT }
	| { kind: typeof FROM_WEBVIEW.UI_RESPONSE; response: RpcExtensionUiResponse }
	| { kind: typeof FROM_WEBVIEW.COMMAND; command: { type: string; [k: string]: unknown } }
	| { kind: typeof FROM_WEBVIEW.REQUEST_STATE }
	| { kind: typeof FROM_WEBVIEW.REQUEST_SUB_USAGE; token?: number }
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
	| { kind: typeof FROM_WEBVIEW.REQUEST_USAGE; file: string }
	| { kind: typeof FROM_WEBVIEW.SLASH; text: string }
	| { kind: typeof FROM_WEBVIEW.WEBVIEW_READY };

export interface ChatBackendOpts {
	/** Fires when Pi reports a session name change (initial load or rename). */
	onSessionName?: (name: string) => void;
	/** Whether the hosting view/panel is currently visible to the user. When it
	 *  isn't, input-wait moments (ui.select / confirm / input dialogs) raise a
	 *  toast + attention badge so the user notices without the panel open. */
	isVisible?: () => boolean;
	/** Set (count > 0) or clear (count = 0) the attention badge on the hosting
	 *  view. No-op for hosts without a badge surface (editor panels). */
	onAttention?: (count: number, tooltip: string) => void;
	/** Bring the hosting view/panel on screen (toast "Open Chat" action). */
	reveal?: () => void;
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
	/** Observers (settings panel) fired whenever the static cache changes —
	 *  lets the settings panel refresh its dropdowns when the chat side pulls
	 *  fresh models, so opening Settings before any chat session has run no
	 *  longer leaves provider lists empty. */
	private static _cacheObservers = new Set<() => void>();
	static onCacheUpdate(fn: () => void): () => void {
		ChatBackend._cacheObservers.add(fn);
		return () => ChatBackend._cacheObservers.delete(fn);
	}

	/** Spawn config for Pi — set once at extension activation. Every
	 *  ChatBackend instance (and the standalone settings fetch) spawns
	 *  through this so the bundled-vs-system Pi decision is centralized. */
	private static _launchConfig: PiLaunchConfig | undefined;
	static setLaunchConfig(cfg: PiLaunchConfig): void {
		ChatBackend._launchConfig = cfg;
	}
	static getLaunchConfig(): PiLaunchConfig {
		if (!ChatBackend._launchConfig) {
			throw new Error(
				"ChatBackend.setLaunchConfig() not called — extension activation order bug.",
			);
		}
		return ChatBackend._launchConfig;
	}
	private static setCache(models: ModelEntry[]): void {
		ChatBackend._cachedModels = models;
		for (const fn of ChatBackend._cacheObservers) {
			try {
				fn();
			} catch (err) {
				console.error("[hmm-code:chat-backend] cache observer threw:", err);
			}
		}
	}
	/** Trigger a model fetch on the first available live backend. Used by the
	 *  settings panel when it opens before any chat has run, so dropdowns
	 *  populate without requiring the user to open chat first. Falls back to
	 *  a transient PiClient when no live backend exists yet — settings can
	 *  work standalone. */
	static requestModelsOnce(): void {
		for (const b of ChatBackend._live) {
			b.scheduleModelRefresh(0);
			return;
		}
		ChatBackend.fetchModelsStandalone().catch((err) => {
			console.error("[hmm-code:chat-backend] standalone model fetch failed:", err);
		});
	}

	/** Spawn a one-shot pi --mode rpc, pull get_available_models, hydrate the
	 *  static cache (which fires observers → settings panel auto-refreshes),
	 *  then stop. Lets the settings panel function without ever opening a
	 *  chat tab. */
	private static async fetchModelsStandalone(): Promise<void> {
		const cwd =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? undefined;
		const client = new PiClient();
		// PiClient extends EventEmitter — an unheard 'error' (spawn failure on
		// the system-fallback path) would throw as an uncaughtException and
		// crash the host. The rejected send() below surfaces the real failure.
		client.on("error", () => {});
		try {
			const launch = ChatBackend.getLaunchConfig();
			client.start({ piBin: launch.cmd, args: launch.args, env: launch.env, cwd });
			const res = await client.send({ type: "get_available_models" }, 30_000);
			if (!res.success) return;
			const data = res.data as { models?: any[] };
			const raw = (data.models ?? []) as ModelEntry[];
			const { aliases } = readModelMaps();
			const withAliases = attachAliases(raw, aliases);
			ChatBackend.setCache(withAliases);
		} finally {
			client.stop();
		}
	}
	/** Live instances (sidebar + every open ChatPanel). The settings panel
	 *  triggers `restartAll()` after auth changes so every Pi process picks
	 *  up the new auth.json — not just the sidebar. */
	private static _live = new Set<ChatBackend>();
	static restartAll(): void {
		let any = false;
		for (const b of ChatBackend._live) {
			b.restart();
			any = true;
		}
		// No live chat view (only the settings panel is open): nothing restarted,
		// so refresh the model cache via a one-shot fetch with the new auth.json
		// — otherwise the settings dropdowns stay stale until a window reload.
		if (!any) ChatBackend.requestModelsOnce();
	}

	private modelRefreshTimer: NodeJS.Timeout | undefined;
	private restartTimer: NodeJS.Timeout | undefined;
	private scheduleModelRefresh(delayMs: number): void {
		if (this.modelRefreshTimer) clearTimeout(this.modelRefreshTimer);
		this.modelRefreshTimer = setTimeout(async () => {
			this.modelRefreshTimer = undefined;
			if (this.disposed || !this.client) return;
			try {
				const res = await this.client.send({ type: "get_available_models" });
				if (!res.success) return;
				const data = res.data as { models?: any[] };
				const raw = (data.models ?? []) as ModelEntry[];
				const { aliases, allowlist } = readModelMaps();
				const withAliases = attachAliases(raw, aliases);
				// Static cache stays UNFILTERED so the settings panel can
				// expose every model in the allowlist UI. Filter is only
				// applied to what we push to the chat webview's picker.
				ChatBackend.setCache(withAliases);
				const visible = applyAllowlist(withAliases, allowlist);
				this.post({ kind: TO_WEBVIEW.MODELS, models: visible });
			} catch (err) {
				console.error("[hmm-code:chat-backend] post-reload model refresh failed:", err);
			}
		}, delayMs);
	}

	constructor(
		private readonly webview: vscode.Webview,
		private readonly opts: ChatBackendOpts = {},
	) {
		webview.onDidReceiveMessage((raw: FromWebview) => this.handleFromWebview(raw));
		ChatBackend._live.add(this);
	}

	private notifySessionName(name: unknown): void {
		if (typeof name === "string" && name.trim()) {
			this.opts.onSessionName?.(name);
		}
	}

	/** Toast + badge when Pi is waiting on a dialog answer (ui.select / confirm /
	 *  input) and the hosting view is not visible. Visible view → the modal is
	 *  already on screen; do nothing. Throttled to one toast per wait: the badge
	 *  clears when the user answers (UI_RESPONSE) or the provider clears it on
	 *  visibility change. */
	private raiseAttention(): void {
		if (!this.opts.isVisible || this.opts.isVisible()) return;
		this.opts.onAttention?.(1, t("host.awaitingInput"));
		void vscode.window
			.showInformationMessage(t("host.awaitingInput"), t("host.openChat"))
			.then((pick) => {
				if (pick) this.opts.reveal?.();
			});
	}

	/**
	 * Push the active session's name to the tab title from an AUTHORITATIVE
	 * source (get_state / a fresh session). Unlike notifySessionName, an empty
	 * or absent name is forwarded as "" so the title resets to default — a
	 * fresh/unnamed session (e.g. spawned after deleting the active one) must
	 * not keep the gone session's name. (The session_info_changed side-channel
	 * still uses notifySessionName, which only ever carries a real name.)
	 */
	private syncSessionTitle(name: unknown): void {
		this.opts.onSessionName?.(typeof name === "string" && name.trim() ? name : "");
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
		c.on("ui-request", (req: RpcExtensionUiRequest) => {
			this.post({ kind: TO_WEBVIEW.UI_REQUEST, req });
			this.raiseAttention();
		});
		c.on("ui-hint", (hint: RpcExtensionUiRequest) =>
			this.post({ kind: TO_WEBVIEW.UI_HINT, hint }),
		);
		c.on("stderr", (text: string) => {
			// Suppress ALL auto-title diagnostics from the chat surface — they
			// are an internal background job (separate LLM call to name the
			// session) that the user shouldn't see in chat. Errors still go
			// to Pi's process stderr so they're recoverable via Output panel /
			// terminal logs, just not in the user's conversation view.
			const filtered = text
				.split(/\r?\n/)
				.filter((line) => !/^\s*\[auto-title\]/.test(line))
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
			const launch = ChatBackend.getLaunchConfig();
			c.start({ piBin: launch.cmd, args: launch.args, env: launch.env, cwd });
			this.client = c;
			this.disableBuiltinAutoCompaction(c);
			this.post({ kind: TO_WEBVIEW.READY });
			// Host-side model re-pull once the new process is up. This is what
			// refreshes the picker + the settings panel's cached model list after
			// a restart (e.g. an OAuth login or auth removal added/removed a
			// provider) — without relying on the webview to ask, so it works even
			// when only the settings panel is open.
			this.scheduleModelRefresh(1200);
		} catch (err) {
			this.post({ kind: TO_WEBVIEW.STDERR, text: `Failed to spawn pi: ${(err as Error).message}` });
		}
	}

	/** Disable Pi's BUILT-IN auto-compaction on the live session so the hmm-code-pi
	 *  extension is the sole compaction authority (it owns the threshold,
	 *  boundary-only timing, and compactModel via its turn_end/agent_end hooks →
	 *  ctx.compact()). Pi's built-in otherwise fires at its own reserveTokens point,
	 *  independent of our configured threshold. autoCompactionEnabled is per-session
	 *  and re-defaults to enabled whenever a session is created/switched, so we
	 *  re-send after every session-reset command (new_session/switch_session/fork/
	 *  clone), not just at spawn. Fire-and-forget. */
	private disableBuiltinAutoCompaction(client: PiClient): void {
		client.sendNoReply({ type: "set_auto_compaction", enabled: false } as any);
	}

	dispose(): void {
		this.disposed = true;
		if (this.modelRefreshTimer) {
			clearTimeout(this.modelRefreshTimer);
			this.modelRefreshTimer = undefined;
		}
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}
		this.client?.removeAllListeners();
		this.client?.stop();
		this.client = undefined;
		ChatBackend._live.delete(this);
	}

	/** Tear down the live Pi process and spawn a fresh one. Used by the
	 *  settings panel after auth changes — Pi's `ctx.reload()` doesn't
	 *  refresh AuthStorage, so a full process restart is the reliable
	 *  way to pick up auth.json edits (e.g. removing a stale credential).
	 *  The webview's persisted lastSessionFile triggers auto switch_session
	 *  on the new ready event, so the user lands back on the same chat. */
	restart(): void {
		if (this.disposed) return;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}
		const old = this.client;
		this.client = undefined;
		if (!old) {
			this.start(this.cwd);
			return;
		}
		// Detach our listeners so late stderr/exit/event from the dying process
		// can't post to the webview and race the fresh process's READY.
		old.removeAllListeners();
		let respawned = false;
		const respawn = (): void => {
			if (respawned || this.disposed) return;
			respawned = true;
			if (this.restartTimer) {
				clearTimeout(this.restartTimer);
				this.restartTimer = undefined;
			}
			this.start(this.cwd);
		};
		// Spawn the replacement only after the old process has actually exited
		// so two pi processes never hold the same session JSONL at once. stop()
		// escalates to SIGKILL, so 'exit' is guaranteed; the timer is a backstop
		// in case it doesn't arrive.
		old.once("exit", respawn);
		old.stop();
		this.restartTimer = setTimeout(respawn, 2500);
		this.restartTimer.unref?.();
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
				this.syncSessionTitle((stateRes.data as any)?.sessionName);
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
					const res = await client.send(
						raw.images && raw.images.length
							? { type: "prompt", message: raw.text, images: raw.images }
							: { type: "prompt", message: raw.text },
					);
					// Pi acks the prompt after preflight succeeds; a FAILED preflight
					// (no model / no auth) resolves with success:false and emits NO
					// turn lifecycle events — so the webview's optimistic loading
					// state would spin forever. Surface the reason and end the turn.
					if (!res.success) {
						this.post({
							kind: TO_WEBVIEW.STDERR,
							text: res.error
								? t("chat.promptFail.withError", { error: res.error })
								: t("chat.promptFail.noModel"),
						});
						this.post({ kind: TO_WEBVIEW.EVENT, event: { type: "turn_end" } });
					}
				} catch (err) {
					this.post({ kind: TO_WEBVIEW.STDERR, text: `prompt failed: ${(err as Error).message}` });
					// Timeout / transport failure also strands the spinner — clear it.
					this.post({ kind: TO_WEBVIEW.EVENT, event: { type: "turn_end" } });
				}
				return;
			case FROM_WEBVIEW.STEER:
				// Mid-turn interjection: Pi queues it and delivers at the next tool
				// boundary. No turn-lifecycle handling here — the turn is already
				// in flight and its events keep streaming as usual.
				try {
					await client.send(
						raw.images && raw.images.length
							? { type: "steer", message: raw.text, images: raw.images }
							: { type: "steer", message: raw.text },
					);
				} catch (err) {
					this.post({ kind: TO_WEBVIEW.STDERR, text: `steer failed: ${(err as Error).message}` });
				}
				return;
			case FROM_WEBVIEW.ABORT:
				client.sendNoReply({ type: "abort" });
				return;
			case FROM_WEBVIEW.UI_RESPONSE:
				client.sendUiResponse(raw.response);
				// The user answered the pending dialog — the attention is consumed.
				this.opts.onAttention?.(0, "");
				return;
			case FROM_WEBVIEW.COMMAND: {
				const cmd = raw.command;
				try {
					// 120s: session-reset commands (switch_session/new_session/fork)
					// load + rebuild a session, which on a very large session can run
					// past a tighter ceiling. A premature timeout rejects here while
					// Pi keeps going, leaving host and webview disagreeing about the
					// active session (the late success is now dropped, not re-emitted —
					// see pi-client.handleLine — so it can't desync, but the user would
					// still see a false failure). The generous ceiling avoids that.
					const res = await client.send(cmd as any, 120_000);
					if (!res.success) {
						this.post({ kind: TO_WEBVIEW.STDERR, text: `${cmd.type} failed: ${res.error}` });
						return;
					}
					if (SESSION_RESET_COMMANDS.has(cmd.type)) {
						const data = res.data as { cancelled?: boolean } | undefined;
						// session_start isn't delivered to RPC subscribers, so we
						// synthesize one for the webview to clear/reload the view.
						if (!data?.cancelled) {
							// The new/switched session re-defaults built-in auto-compaction
							// to enabled — re-disable so it can't race our extension's
							// compaction (see disableBuiltinAutoCompaction).
							this.disableBuiltinAutoCompaction(client);
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
						this.syncSessionTitle((res.data as any)?.sessionName);
					}
				} catch (err) {
					this.post({ kind: TO_WEBVIEW.STDERR, text: `get_state failed: ${(err as Error).message}` });
				}
				return;
			case FROM_WEBVIEW.REQUEST_COMMANDS:
				try {
					const res = await client.send({ type: "get_commands" });
					if (res.success) {
						const data = res.data as { commands?: SlashCommand[] };
						this.post({ kind: TO_WEBVIEW.COMMANDS, commands: data.commands ?? [] });
					}
				} catch (err) {
					// Non-fatal — the prompt just won't have autocomplete this session.
					console.error("[hmm-code:chat-backend] get_commands failed:", err);
				}
				return;
			case FROM_WEBVIEW.REQUEST_USAGE: {
				// ctx-pill click: per-model token totals for the current session and
				// every session it spawned (parent includes children).
				const file = raw.file;
				if (typeof file !== "string" || !file) return;
				try {
					const { perModel, sessionCount } = subtreeUsage(file, this.workspaceCwd());
					// Also pull the current model's live context fill (tokens / window
					// / %) so the modal can draw a gauge. get_session_stats carries
					// getContextUsage(); it's optional — a failure just omits the gauge.
					let context: { tokens: number; contextWindow: number; percent: number } | undefined;
					try {
						const stats = await client.send({ type: "get_session_stats" });
						const cu = stats.success ? (stats.data as any)?.contextUsage : undefined;
						if (
							cu &&
							typeof cu.tokens === "number" &&
							typeof cu.contextWindow === "number" &&
							cu.contextWindow > 0 &&
							typeof cu.percent === "number"
						) {
							context = { tokens: cu.tokens, contextWindow: cu.contextWindow, percent: cu.percent };
						}
					} catch {
						/* gauge is best-effort */
					}
					this.post({ kind: TO_WEBVIEW.USAGE, perModel, sessionCount, context });
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `usage failed: ${(err as Error).message}`,
					});
				}
				return;
			}
			case FROM_WEBVIEW.REQUEST_SUB_USAGE:
				// Topbar usage button: plan usage for every connected subscription.
				// collectSubscriptionUsage never rejects (per-provider catch). The
				// echoed token lets the modal drop replies that arrive after it
				// closed or reopened.
				this.post({ kind: TO_WEBVIEW.SUB_USAGE, token: raw.token, entries: await collectSubscriptionUsage() });
				return;
			case FROM_WEBVIEW.LIST_SESSIONS:
				await this.refreshSessions();
				return;
			case FROM_WEBVIEW.DELETE_SESSION: {
				// If the file being deleted (or any of its descendants — delete
				// cascades through the parent→child tree) is the one Pi is
				// actively writing to, spin up a new session FIRST so Pi
				// releases the file handle. Otherwise the chat tab would be
				// left showing a session that no longer exists on disk and
				// Pi would keep trying to append to the deleted path.
				let isCurrent = false;
				if (client) {
					try {
						const stateRes = await client.send({ type: "get_state" });
						if (stateRes.success) {
							const f = (stateRes.data as { sessionFile?: string })?.sessionFile;
							if (typeof f === "string") {
								// Treat as "current is being deleted" whenever the active
								// session is in the cascade set — covers the case where the
								// user deletes an ancestor and cascade wipes the active
								// child too. Case-insensitive contains() because macOS/Win
								// preserve case in path strings but the FS is case-folded —
								// Pi's sessionFile and the cascade entries may differ
								// (`/Users/foo/dev/...` vs `/Users/foo/Dev/...`).
								const cascade = collectCascade(raw.file, this.workspaceCwd());
								const fLower = f.toLowerCase();
								for (const c of cascade) {
									if (c.toLowerCase() === fLower) {
										isCurrent = true;
										break;
									}
								}
							}
						}
					} catch {
						/* probe failure isn't fatal — fall through to delete */
					}
				}
				if (isCurrent && client) {
					try {
						const res = await client.send({ type: "new_session" });
						if (res.success) {
							// New session re-defaults built-in auto-compaction on — re-disable.
							this.disableBuiltinAutoCompaction(client);
							// The spawned session has no name yet — reset the tab title
							// now so it doesn't keep the just-deleted session's name
							// (the webview's follow-up get_state would also reset it,
							// but do it immediately to avoid a visible stale flash).
							this.syncSessionTitle("");
							// SESSION_START isn't pushed to RPC subscribers for
							// new_session; synthesize it so the webview clears
							// the chat and rebinds to the new file.
							this.post({
								kind: TO_WEBVIEW.EVENT,
								event: { type: "session_start", reason: "new_session" },
							});
						}
					} catch (err) {
						this.post({
							kind: TO_WEBVIEW.STDERR,
							text: `new_session before delete failed: ${(err as Error).message}`,
						});
					}
				}
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
			}
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
			case FROM_WEBVIEW.SLASH:
				if (typeof raw.text === "string" && raw.text) this.prompt(raw.text);
				return;
			case FROM_WEBVIEW.WEBVIEW_READY:
				// Webview's listener is now wired — (re-)send READY so its boot
				// handler (LIST_SESSIONS + auto-resume + state/context/commands) runs.
				// The eager READY in start() races the webview script load and is
				// usually dropped on (re)load.
				this.post({ kind: TO_WEBVIEW.READY });
				return;
			case FROM_WEBVIEW.OPEN_FILE: {
				// Ctrl/Cmd-click on a file path in a tool summary. Resolve
				// relative paths against the current cwd (Pi's working dir,
				// which the user opened the workspace at). vscode.open errors
				// if the file doesn't exist; we just surface that to stderr.
				const p = raw.path;
				if (typeof p !== "string" || !p) return;
				const abs = p.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(p)
					? p
					: this.cwd
						? `${this.cwd.replace(/\/$/, "")}/${p}`
						: p;
				try {
					await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(abs));
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `open-file failed (${abs}): ${(err as Error).message}`,
					});
				}
				return;
			}
			case FROM_WEBVIEW.OPEN_TEXT: {
				// Ctrl/Cmd-click on a bash command → open the full command text in
				// a scratch (untitled) editor tab so long / `&&`-chained commands
				// are readable, selectable, and copyable.
				const text = raw.text;
				if (typeof text !== "string" || !text) return;
				try {
					const doc = await vscode.workspace.openTextDocument({
						content: text,
						language: typeof raw.language === "string" ? raw.language : "shellscript",
					});
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch (err) {
					this.post({
						kind: TO_WEBVIEW.STDERR,
						text: `open-text failed: ${(err as Error).message}`,
					});
				}
				return;
			}
			case FROM_WEBVIEW.REQUEST_MESSAGES:
				try {
					// Render the FULL on-disk transcript, not get_messages (which returns
					// only the compacted model context — so old turns would vanish from
					// the chat after a compaction). get_state gives the active session
					// file; readSessionMessages reconstructs its branch from the .jsonl.
					// Fall back to get_messages for an unsaved/empty session (no file yet).
					let messages: unknown[] = [];
					const st = await client.send({ type: "get_state" });
					const file = st.success ? (st.data as { sessionFile?: unknown })?.sessionFile : undefined;
					if (typeof file === "string" && file) messages = readSessionMessages(file);
					if (messages.length === 0) {
						const res = await client.send({ type: "get_messages" });
						if (res.success) messages = ((res.data as { messages?: unknown[] }).messages ?? []);
					}
					// Webview-measured timing stats live IN the transcript (webview-stats
					// custom entries, keyed by message timestamp) — replay restores
					// "Thought for Ns" + the per-message stats toggle from them.
					const stats = typeof file === "string" && file ? readSessionStats(file) : {};
					this.post({ kind: TO_WEBVIEW.MESSAGES, messages, stats });
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
						const raw = (data.models ?? []) as ModelEntry[];
						// Read modes.json on every request — small file, may have
						// been edited since last pull.
						const { aliases, allowlist } = readModelMaps();
						const withAliases = attachAliases(raw, aliases);
						// Cache is UNFILTERED so the settings panel can offer every
						// model in the allowlist UI; the chat webview gets the
						// filtered subset for its picker.
						ChatBackend.setCache(withAliases);
						const visible = applyAllowlist(withAliases, allowlist);
						this.post({ kind: TO_WEBVIEW.MODELS, models: visible });
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
	const csp = buildCsp(webview, nonce, webview.cspSource);
	// Inject version/publisher + the locale dict BEFORE the main script loads
	// so dom.ts (empty-state HTML) and i18n.ts can read them. JSON.stringify
	// escapes any quotes/control chars so it's safe inside a <script>.
	const infoLiteral = jsonForScript(info);
	const i18nLiteral = jsonForScript(getWebviewMessages());
	const cfgLiteral = jsonForScript({
		autoApproveDefault: readAutoApproveDefault(),
		todoPanel: readTodoPanel(),
	});
	return `<!DOCTYPE html>
<html lang="${resolveLocale()}">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Hmm-code</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">window.__HMM_INFO = ${infoLiteral}; window.__HMM_I18N = ${i18nLiteral}; window.__HMM_CFG = ${cfgLiteral};</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

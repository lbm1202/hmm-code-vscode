// Standalone settings panel — direct file editor for Pi config.
//
// Inline editing (no chat dispatch):
//   - modes.json  → per-mode model + thinking, modelAliases
//   - auth.json   → API-key credentials (add/remove). Subscription OAuth
//                   providers (currently anthropic Claude Pro/Max) need the
//                   pi-ai/oauth browser flow — driven by an inline login button.
//   - models.json → custom OpenAI-compatible providers + model definitions
//
// Single save bar at the bottom commits all dirty sections in one shot
// and pings the sidebar's Pi process via /reload-runtime so the running
// session sees the changes immediately.

import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ChatBackend } from "./chat-backend";
import { anthropicOAuthLogin } from "./oauth-anthropic";
import { fetchAnthropicUsage } from "./anthropic-usage";
import { codexOAuthLogin } from "./oauth-codex";
import { fetchCodexUsage } from "./codex-usage";
import { buildCsp, jsonForScript, makeNonce } from "./webview-html";
import { getWebviewMessages, resolveLocale, t } from "./i18n";

const VIEW_TYPE = "hmm-code.settingsPanel";
const PI_DIR = join(homedir(), ".pi", "agent");
const MODES_PATH = join(PI_DIR, "modes.json");
const MODELS_PATH = join(PI_DIR, "models.json");
const AUTH_PATH = join(PI_DIR, "auth.json");
const SETTINGS_PATH = join(PI_DIR, "settings.json");

const MODE_NAMES = ["plan", "code", "review", "debug", "ask"] as const;
// OAuth-only providers — auth.json entries need a browser redirect flow that
// belongs in the pi-ai/oauth package. Wired inline via the auth-section login
// buttons (Anthropic Claude Pro/Max + OpenAI Codex).
const OAUTH_PROVIDERS: { id: string; name: string }[] = [];
// Common OpenAI-compatible API types Pi understands.
const API_TYPES = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
];

export class SettingsPanel {
	public static readonly viewType = VIEW_TYPE;
	private static instance: vscode.WebviewPanel | undefined;
	/** In-flight OAuth login (anthropic) — process-global single-flight,
	 *  aborted on panel dispose so the callback server can't leak. */
	private static _oauthLoginAbort: AbortController | undefined;
	/** Extension install root — set on attach so static readState can locate the
	 *  bundled hmm-code-pi (for the per-mode default prompts). */
	private static _extPath = "";
	/** Cached default mode prompts parsed from the bundled config.ts. */
	private static _defaultPrompts: Record<string, string> | undefined;

	static open(ctx: vscode.ExtensionContext): void {
		if (SettingsPanel.instance) {
			SettingsPanel.instance.reveal(vscode.ViewColumn.Active);
			SettingsPanel.refresh(SettingsPanel.instance);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			t("settings.panelTitle"),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(ctx.extensionUri, "media"),
					vscode.Uri.joinPath(ctx.extensionUri, "out"),
				],
			},
		);
		SettingsPanel.attach(panel, ctx);
	}

	static adopt(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(ctx.extensionUri, "media"),
				vscode.Uri.joinPath(ctx.extensionUri, "out"),
			],
		};
		SettingsPanel.attach(panel, ctx);
	}

	private static attach(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		SettingsPanel._extPath = ctx.extensionUri.fsPath;
		panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "tab-icon.svg");
		panel.webview.html = SettingsPanel.html(panel.webview, ctx.extensionUri);
		SettingsPanel.instance = panel;

		panel.webview.onDidReceiveMessage(async (msg: any) => {
			try {
				await SettingsPanel.handleMessage(panel, msg);
			} catch (err) {
				panel.webview.postMessage({
					kind: "error",
					message: (err as Error).message,
				});
			}
		});

		// Re-push state whenever ChatBackend's static model cache updates so
		// dropdowns repopulate even if the panel was opened before any chat
		// session had pulled get_available_models. Without this, opening
		// Settings first → opening chat after leaves all model dropdowns
		// stuck on "(default)".
		const unsubscribe = ChatBackend.onCacheUpdate(() => SettingsPanel.refresh(panel));

		panel.onDidDispose(() => {
			unsubscribe();
			// Abort any in-flight OAuth login so its callback server is torn down
			// with the panel — otherwise it leaks and the next login attempt
			// fails with EADDRINUSE until the host restarts.
			SettingsPanel._oauthLoginAbort?.abort?.();
			SettingsPanel._oauthLoginAbort = undefined;
			if (SettingsPanel.instance === panel) SettingsPanel.instance = undefined;
		});

		setTimeout(() => SettingsPanel.refresh(panel), 50);
	}

	private static refresh(panel: vscode.WebviewPanel): void {
		panel.webview.postMessage({
			kind: "state",
			state: SettingsPanel.readState(),
		});
		// If no chat session has populated the model cache yet, ask the first
		// live backend to fetch. The cache observer above will then trigger a
		// follow-up refresh once the data lands.
		if (ChatBackend.cachedModels().length === 0) {
			ChatBackend.requestModelsOnce();
		}
	}

	private static readState() {
		const modes = SettingsPanel.readJsonSafe(MODES_PATH);
		const auth = SettingsPanel.readJsonSafe(AUTH_PATH);
		const models = SettingsPanel.readJsonSafe(MODELS_PATH);
		// Strip credential VALUES before sending to the webview — only metadata
		// (provider id + type) crosses the postMessage boundary. Webview never
		// sees real API keys / tokens.
		const authSafe: Record<string, { type: string }> = {};
		if (auth && typeof auth === "object") {
			for (const [id, cred] of Object.entries(auth as any)) {
				if (cred && typeof cred === "object") {
					authSafe[id] = { type: String((cred as any).type ?? "?") };
				}
			}
		}
		// Built-in + custom models known to the live Pi process (cached
		// whenever the sidebar pulls get_available_models). Used to populate
		// the mode-config dropdowns so the user only sees real choices.
		// Includes alias (from modes.json:modelAliases) so dropdowns can show
		// the user's friendly name instead of the raw id.
		const availableModels = ChatBackend.cachedModels().map((m: any) => ({
			provider: String(m.provider ?? ""),
			id: String(m.id ?? ""),
			alias: m.alias ? String(m.alias) : undefined,
			// Thinking metadata so the mode-set thinking dropdown can mirror the
			// chat picker (off-only for non-reasoning, off/on for binary
			// qwen/zai, leveled otherwise).
			reasoning: m.reasoning === true,
			thinkingLevelMap: m.thinkingLevelMap ?? undefined,
			thinkingFormat: m.compat?.thinkingFormat ?? undefined,
		}));
		// Allowlist map lives inside modes.json:modelAllowlist. Surface it as
		// a top-level field so the allowlist UI doesn't need to reach into
		// the modes blob.
		const modelAllowlist =
			modes && typeof modes === "object" && modes.modelAllowlist && typeof modes.modelAllowlist === "object"
				? (modes.modelAllowlist as Record<string, string[]>)
				: {};
		return {
			modesPath: MODES_PATH,
			modelsPath: MODELS_PATH,
			authPath: AUTH_PATH,
			settingsPath: SETTINGS_PATH,
			modes,
			auth: authSafe,
			models,
			availableModels,
			modelAllowlist,
			oauthProviders: OAUTH_PROVIDERS,
			apiTypes: API_TYPES,
			defaultPrompts: SettingsPanel.defaultPrompts(),
			autoCompactThreshold:
				modes && typeof modes === "object" && typeof modes.autoCompactThreshold === "number"
					? modes.autoCompactThreshold
					: null,
			defaultCompactThreshold: SettingsPanel.defaultCompactThreshold(),
			defaultAutoTitlePrompt: SettingsPanel.defaultAutoTitlePrompt(),
			dynamicCompaction:
				modes && typeof modes === "object" && typeof modes.dynamicCompaction === "boolean"
					? modes.dynamicCompaction
					: true,
			includeOldToolOutputs:
				modes && typeof modes === "object" && modes.includeOldToolOutputs === true,
			autoApproveDefault:
				modes && typeof modes === "object" && modes.autoApproveDefault === true,
			todoPanel: !(modes && typeof modes === "object" && modes.todoPanel === false),
			autoContinueAfterCompact: !(
				modes && typeof modes === "object" && modes.autoContinueAfterCompact === false
			),
			artifactRetentionDays:
				modes && typeof modes === "object" && typeof modes.artifactRetentionDays === "number"
					? modes.artifactRetentionDays
					: null,
			defaultMode:
				modes &&
				typeof modes === "object" &&
				(MODE_NAMES as readonly string[]).includes(modes.defaultMode)
					? modes.defaultMode
					: "code",
		};
	}

	/** Parse the per-mode default `systemPromptAddendum` strings out of the
	 *  bundled hmm-code-pi config.ts. They're authored as string arrays joined
	 *  with "\n"; we extract each array literal and JSON.parse it. Cached.
	 *  Returns {} if the bundle is absent (system-Pi fallback) — the UI then
	 *  just shows the user's override with no default reference. */
	private static defaultPrompts(): Record<string, string> {
		if (SettingsPanel._defaultPrompts) return SettingsPanel._defaultPrompts;
		const out: Record<string, string> = {};
		try {
			const cfgPath = join(SettingsPanel._extPath, "out", "vendor", "hmm-code-pi", "config.ts");
			const src = readFileSync(cfgPath, "utf-8");
			for (const mode of MODE_NAMES) {
				const re = new RegExp(
					`${mode}:\\s*\\{[\\s\\S]*?systemPromptAddendum:\\s*\\[([\\s\\S]*?)\\]\\.join\\(`,
				);
				const m = src.match(re);
				if (!m) continue;
				const body = m[1].replace(/,\s*$/, "");
				try {
					const arr = JSON.parse(`[${body}]`) as unknown[];
					out[mode] = arr.map((s) => String(s)).join("\n");
				} catch {
					/* leave this mode's default empty if it won't parse */
				}
			}
		} catch {
			/* bundle missing — return whatever we have (possibly {}) */
		}
		SettingsPanel._defaultPrompts = out;
		return out;
	}

	/** Parse the built-in AUTO_COMPACT_THRESHOLD out of the bundled constants.ts
	 *  so the panel shows the real default without mirroring the number. */
	private static defaultCompactThreshold(): number {
		try {
			const p = join(SettingsPanel._extPath, "out", "vendor", "hmm-code-pi", "constants.ts");
			const m = readFileSync(p, "utf-8").match(/AUTO_COMPACT_THRESHOLD\s*=\s*(\d+)/);
			if (m) return Number(m[1]);
		} catch {
			/* bundle missing */
		}
		return 75;
	}

	/** Parse the built-in DEFAULT_AUTO_TITLE_PROMPT (single-line literal) out of
	 *  the bundled constants.ts so the panel pre-fills the auto-title editor with
	 *  the real default — no mirrored copy that could drift. */
	private static defaultAutoTitlePrompt(): string {
		try {
			const p = join(SettingsPanel._extPath, "out", "vendor", "hmm-code-pi", "constants.ts");
			const src = readFileSync(p, "utf-8");
			const m = src.match(/DEFAULT_AUTO_TITLE_PROMPT\s*=\s*"((?:[^"\\]|\\.)*)"/);
			if (m) return JSON.parse(`"${m[1]}"`) as string;
		} catch {
			/* bundle missing — panel falls back to empty (placeholder shows) */
		}
		return "";
	}

	private static readJsonSafe(path: string): any {
		if (!existsSync(path)) return null;
		try {
			return JSON.parse(readFileSync(path, "utf-8"));
		} catch {
			return null;
		}
	}

	/** Drive an inline OAuth login flow for any provider, writing the resulting
	 *  credential to auth.json and restarting chat. Single-flight across all
	 *  providers (one browser login at a time) via the shared _oauthLoginAbort. */
	private static async runOAuthLogin(
		panel: vscode.WebviewPanel,
		opts: {
			statusKind: string;
			providerId: string;
			label: string;
			run: (
				cb: {
					onAuth: (info: { url: string; instructions?: string }) => void;
					onProgress?: (message: string) => void;
				},
				signal: AbortSignal,
			) => Promise<unknown>;
		},
	): Promise<void> {
		if (SettingsPanel._oauthLoginAbort) {
			panel.webview.postMessage({ kind: opts.statusKind, state: "running" });
			return;
		}
		const abort = new AbortController();
		SettingsPanel._oauthLoginAbort = abort;
		panel.webview.postMessage({ kind: opts.statusKind, state: "starting", message: t("settings.oauth.flowStart") });
		try {
			const creds = await opts.run(
				{
					onAuth: ({ url, instructions }) => {
						vscode.env.openExternal(vscode.Uri.parse(url));
						panel.webview.postMessage({
							kind: opts.statusKind,
							state: "browser",
							url,
							message: instructions ?? t("settings.oauth.browser"),
						});
					},
					onProgress: (message) => {
						panel.webview.postMessage({ kind: opts.statusKind, state: "progress", message });
					},
				},
				abort.signal,
			);
			// Write to auth.json with the shape Pi's AuthStorage expects.
			const raw: any = SettingsPanel.readJsonSafe(AUTH_PATH) ?? {};
			raw[opts.providerId] = creds;
			mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
			writeFileSync(AUTH_PATH, JSON.stringify(raw, null, 2), "utf-8");
			try {
				chmodSync(AUTH_PATH, 0o600);
			} catch {
				/* non-POSIX */
			}
			// Full pi restart so AuthStorage picks up the new oauth entry.
			vscode.commands.executeCommand("hmm-code.restartChat");
			panel.webview.postMessage({
				kind: opts.statusKind,
				state: "success",
				message: t("settings.oauth.saved", { label: opts.label }),
			});
			SettingsPanel.refresh(panel);
		} catch (err) {
			panel.webview.postMessage({
				kind: opts.statusKind,
				state: "error",
				message: (err as Error).message,
			});
		} finally {
			SettingsPanel._oauthLoginAbort = undefined;
		}
	}

	private static async handleMessage(panel: vscode.WebviewPanel, msg: any): Promise<void> {
		switch (msg?.kind) {
			case "anthropic-login": {
				await SettingsPanel.runOAuthLogin(panel, {
					statusKind: "anthropic-status",
					providerId: "anthropic",
					label: "anthropic (Claude Pro/Max)",
					run: anthropicOAuthLogin,
				});
				return;
			}
			case "anthropic-login-cancel": {
				SettingsPanel._oauthLoginAbort?.abort?.();
				return;
			}
			case "anthropic-usage": {
				try {
					const usage = await fetchAnthropicUsage();
					panel.webview.postMessage({ kind: "anthropic-usage-result", usage });
				} catch (err) {
					panel.webview.postMessage({
						kind: "anthropic-usage-result",
						error: (err as Error).message,
					});
				}
				return;
			}
			case "codex-login": {
				await SettingsPanel.runOAuthLogin(panel, {
					statusKind: "codex-status",
					providerId: "openai-codex",
					label: "openai-codex (ChatGPT Plus/Pro)",
					run: codexOAuthLogin,
				});
				return;
			}
			case "codex-login-cancel": {
				SettingsPanel._oauthLoginAbort?.abort?.();
				return;
			}
			case "codex-usage": {
				try {
					const usage = await fetchCodexUsage();
					panel.webview.postMessage({ kind: "codex-usage-result", usage });
				} catch (err) {
					panel.webview.postMessage({
						kind: "codex-usage-result",
						error: (err as Error).message,
					});
				}
				return;
			}
			case "save": {
				const out: string[] = [];
				// Write models.json first so writeModes can pull derived aliases
				// from model.name in the same pass.
				if (msg.models) {
					SettingsPanel.writeModels(msg.models);
					out.push("models.json");
				}
				if (msg.modes) {
					// model.name IS the alias source — manual alias UI is gone.
					const derived = SettingsPanel.deriveAliasesFromModels(msg.models ?? {});
					SettingsPanel.writeModes(
						derived,
						msg.modeConfigs ?? {},
						msg.autoTitle,
						msg.modelAllowlist,
						msg.autoCompactThreshold,
						msg.compactModel,
						msg.dynamicCompaction,
						msg.autoTitlePrompt,
						msg.compactInstructions,
						msg.includeOldToolOutputs,
						msg.autoApproveDefault,
						msg.todoPanel,
						msg.autoContinueAfterCompact,
						msg.artifactRetentionDays,
						msg.defaultMode,
					);
					if (!out.includes("modes.json")) out.push("modes.json");
				}
				const authChanged =
					(msg.authAdds && Object.keys(msg.authAdds).length > 0) ||
					(msg.authRemoves && msg.authRemoves.length > 0);
				if (authChanged) {
					SettingsPanel.writeAuth(msg.authAdds ?? {}, msg.authRemoves ?? []);
					out.push("auth.json");
				}
				if (out.length > 0) {
					// Any settings change → full process restart. Pi caches
					// AuthStorage in memory and ctx.reload() doesn't re-read
					// auth.json, and the soft /reload-runtime didn't reliably
					// refresh the model list — so restart cleanly picks up
					// auth/models/modes. The chat webview auto-resumes the
					// persisted session, and restart re-pulls models (see
					// ChatBackend.start), so dropdowns update without a window
					// reload.
					vscode.commands.executeCommand("hmm-code.restartChat");
				}
				SettingsPanel.refresh(panel);
				panel.webview.postMessage({ kind: "saved", files: out, restarted: out.length > 0 });
				return;
			}
			case "discover-models": {
				// Fetch `${baseUrl}/models` (OpenAI-compatible) and return the
				// id list to the webview for checkbox bulk-add.
				const baseUrl = String(msg.baseUrl ?? "").trim();
				const apiKey = String(msg.apiKey ?? "").trim();
				const requestId = String(msg.requestId ?? "");
				if (!baseUrl) {
					panel.webview.postMessage({
						kind: "discovered-models",
						requestId,
						error: t("settings.discover.emptyBaseUrl"),
					});
					return;
				}
				try {
					const url = baseUrl.replace(/\/+$/, "") + "/models";
					const headers: Record<string, string> = { Accept: "application/json" };
					if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
					const res = await fetch(url, { headers });
					if (!res.ok) {
						const text = await res.text().catch(() => "");
						throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
					}
					const json: any = await res.json();
					const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
					const ids = data
						.map((m: any) => String(m?.id ?? m?.name ?? "").trim())
						.filter(Boolean);
					panel.webview.postMessage({
						kind: "discovered-models",
						requestId,
						ids: ids.sort((a: string, b: string) => a.localeCompare(b)),
						// Same response carries each model's context window (max_model_len
						// etc.) → adding a discovered model pre-fills contextWindow.
						contexts: ((): Record<string, number> => {
							const c: Record<string, number> = {};
							for (const m of data) {
								const id = String(m?.id ?? m?.name ?? "").trim();
								if (!id) continue;
								const cw = Number(
									m?.max_model_len ??
										m?.max_context_length ??
										m?.context_length ??
										m?.max_position_embeddings ??
										m?.context_window ??
										Number.NaN,
								);
								if (Number.isFinite(cw) && cw > 0) c[id] = cw;
							}
							return c;
						})(),
					});
				} catch (err) {
					panel.webview.postMessage({
						kind: "discovered-models",
						requestId,
						error: (err as Error).message,
					});
				}
				return;
			}
			case "detect-context": {
				// Read each model's context window from `${baseUrl}/models` and
				// return an { id: contextWindow } map. Servers expose it under
				// different keys: vLLM/omlx `max_model_len`, LM Studio
				// `max_context_length`, others `context_length` /
				// `max_position_embeddings`. (Plain OpenAI / vanilla mlx_lm.server
				// don't expose it → empty map → "none detected".)
				const baseUrl = String(msg.baseUrl ?? "").trim();
				const apiKey = String(msg.apiKey ?? "").trim();
				const requestId = String(msg.requestId ?? "");
				const providerName = String(msg.providerName ?? "");
				if (!baseUrl) {
					panel.webview.postMessage({
						kind: "detected-context",
						requestId,
						providerName,
						error: t("settings.discover.emptyBaseUrl"),
					});
					return;
				}
				try {
					const url = baseUrl.replace(/\/+$/, "") + "/models";
					const headers: Record<string, string> = { Accept: "application/json" };
					if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
					const res = await fetch(url, { headers });
					if (!res.ok) {
						const text = await res.text().catch(() => "");
						throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
					}
					const json: any = await res.json();
					const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
					const contexts: Record<string, number> = {};
					for (const m of data) {
						const id = String(m?.id ?? m?.name ?? "").trim();
						if (!id) continue;
						const cw = Number(
							m?.max_model_len ??
								m?.max_context_length ??
								m?.context_length ??
								m?.max_position_embeddings ??
								m?.context_window ??
								Number.NaN,
						);
						if (Number.isFinite(cw) && cw > 0) contexts[id] = cw;
					}
					panel.webview.postMessage({
						kind: "detected-context",
						requestId,
						providerName,
						contexts,
					});
				} catch (err) {
					panel.webview.postMessage({
						kind: "detected-context",
						requestId,
						providerName,
						error: (err as Error).message,
					});
				}
				return;
			}
			case "set-language": {
				const value = String(msg.value ?? "auto");
				const allowed = ["auto", "en", "ko"];
				await vscode.workspace
					.getConfiguration("hmm-code")
					.update("language", allowed.includes(value) ? value : "auto", vscode.ConfigurationTarget.Global);
				// The config-change listener in extension.ts handles the reload prompt.
				return;
			}
			case "refresh":
				SettingsPanel.refresh(panel);
				return;
		}
	}

	/** Build the modelAliases dict from each model's `name` field across all
	 *  custom providers in models.json. Returns:
	 *    - aliasesByKey:   `${provider}/${id}` → name (only for models WITH name)
	 *    - managedKeys:    all `${provider}/${id}` from models.json (with or
	 *                      without a name) — used to know which existing
	 *                      aliases to strip when a name is cleared.
	 */
	private static deriveAliasesFromModels(models: any): {
		aliasesByKey: Record<string, string>;
		managedKeys: Set<string>;
	} {
		const aliasesByKey: Record<string, string> = {};
		const managedKeys = new Set<string>();
		const providers = models?.providers;
		if (!providers || typeof providers !== "object") return { aliasesByKey, managedKeys };
		for (const [provName, cfg] of Object.entries(providers as any)) {
			const list = (cfg as any)?.models;
			if (!Array.isArray(list)) continue;
			for (const m of list) {
				const id = String(m?.id ?? "").trim();
				if (!id) continue;
				const key = `${provName}/${id}`;
				managedKeys.add(key);
				const name = String(m?.name ?? "").trim();
				if (name) aliasesByKey[key] = name;
			}
		}
		return { aliasesByKey, managedKeys };
	}

	private static writeModes(
		derived: { aliasesByKey: Record<string, string>; managedKeys: Set<string> },
		modes: Record<string, { provider?: string; id?: string; thinking?: string; prompt?: string }>,
		autoTitle?: { provider?: string; id?: string } | null,
		modelAllowlist?: Record<string, string[]> | null,
		autoCompactThreshold?: number | null,
		compactModel?: { provider?: string; id?: string } | null,
		dynamicCompaction?: boolean,
		autoTitlePrompt?: string | null,
		compactInstructions?: string | null,
		includeOldToolOutputs?: boolean,
		autoApproveDefault?: boolean,
		todoPanel?: boolean,
		autoContinueAfterCompact?: boolean,
		artifactRetentionDays?: number | null,
		defaultMode?: string | null,
	): void {
		let raw: any = SettingsPanel.readJsonSafe(MODES_PATH) ?? {};
		// Dynamic compaction (default on). Store only when explicitly off so
		// modes.json stays clean when at the default.
		if (dynamicCompaction !== undefined) {
			if (dynamicCompaction === false) raw.dynamicCompaction = false;
			else delete raw.dynamicCompaction;
		}
		// Include old tool outputs (default off → prune). Store only when explicitly
		// on so modes.json stays clean at the default.
		if (includeOldToolOutputs !== undefined) {
			if (includeOldToolOutputs === true) raw.includeOldToolOutputs = true;
			else delete raw.includeOldToolOutputs;
		}
		// Auto-approve on session start (default off). Store only when explicitly on
		// so modes.json stays clean at the default.
		if (autoApproveDefault !== undefined) {
			if (autoApproveDefault === true) raw.autoApproveDefault = true;
			else delete raw.autoApproveDefault;
		}
		// Pinned todo panel (default ON). Store only when explicitly off so
		// modes.json stays clean at the default.
		if (todoPanel !== undefined) {
			if (todoPanel === false) raw.todoPanel = false;
			else delete raw.todoPanel;
		}
		// Auto-continue after compaction (default ON). Store only when explicitly off.
		if (autoContinueAfterCompact !== undefined) {
			if (autoContinueAfterCompact === false) raw.autoContinueAfterCompact = false;
			else delete raw.autoContinueAfterCompact;
		}
		// Default mode for NEW sessions (resumed sessions restore their own).
		// Store only when it differs from the built-in "code" default.
		if (defaultMode !== undefined) {
			if (
				typeof defaultMode === "string" &&
				(MODE_NAMES as readonly string[]).includes(defaultMode) &&
				defaultMode !== "code"
			) {
				raw.defaultMode = defaultMode;
			} else {
				delete raw.defaultMode;
			}
		}
		// Plan/report artifact retention days (default 30; 0 = keep forever).
		// Store only when it differs from the default so modes.json stays clean.
		if (artifactRetentionDays !== undefined) {
			if (
				typeof artifactRetentionDays === "number" &&
				Number.isFinite(artifactRetentionDays) &&
				artifactRetentionDays >= 0 &&
				artifactRetentionDays !== 30
			) {
				raw.artifactRetentionDays = Math.round(artifactRetentionDays);
			} else {
				delete raw.artifactRetentionDays;
			}
		}
		// Auto-title system-prompt override + compaction additional-focus.
		// Empty/whitespace → delete the field so the built-in default applies.
		if (autoTitlePrompt !== undefined) {
			const v = (autoTitlePrompt ?? "").trim();
			if (v) raw.autoTitlePrompt = v;
			else delete raw.autoTitlePrompt;
		}
		if (compactInstructions !== undefined) {
			const v = (compactInstructions ?? "").trim();
			if (v) raw.compactInstructions = v;
			else delete raw.compactInstructions;
		}
		// Compaction (summary) model override. Both blank → delete the field so
		// Pi falls back to the active session model.
		if (compactModel !== undefined) {
			const p = (compactModel?.provider ?? "").trim();
			const i = (compactModel?.id ?? "").trim();
			if (p && i) raw.compactModel = { provider: p, id: i };
			else delete raw.compactModel;
		}
		// Auto-compact threshold: store only when it differs from the built-in
		// default; otherwise drop the field so modes.json stays clean.
		if (autoCompactThreshold !== undefined) {
			const def = SettingsPanel.defaultCompactThreshold();
			const n = Number(autoCompactThreshold);
			// Clamp to the same range Pi enforces on load — [50, 80] with dynamic
			// compaction on, [50, 90] off — so the stored value matches what Pi uses.
			const max = dynamicCompaction === false ? 90 : 80;
			const clamped = Number.isFinite(n) ? Math.min(max, Math.max(50, Math.round(n))) : NaN;
			if (autoCompactThreshold !== null && Number.isFinite(clamped) && clamped !== def) {
				raw.autoCompactThreshold = clamped;
			} else {
				delete raw.autoCompactThreshold;
			}
		}
		// Auto-title model override (consumed by auto-title.ts resolveTitleModel).
		// Both blank → delete the field so the GPT-candidate fallback applies.
		if (autoTitle !== undefined) {
			const p = (autoTitle?.provider ?? "").trim();
			const i = (autoTitle?.id ?? "").trim();
			if (p && i) raw.autoTitle = { provider: p, id: i };
			else delete raw.autoTitle;
		}
		// modelAllowlist: per-provider id list. Semantics:
		//   missing key → no filter for that provider
		//   [] (empty)  → 0 visible (explicit hide-all)
		//   [...]       → only those visible
		// Webview drops the key entirely when the user re-checks every model,
		// so the only way to get a key here is an explicit subset (incl. []).
		if (modelAllowlist !== undefined) {
			const clean: Record<string, string[]> = {};
			if (modelAllowlist) {
				for (const [prov, ids] of Object.entries(modelAllowlist)) {
					if (Array.isArray(ids)) clean[prov] = ids.slice();
				}
			}
			if (Object.keys(clean).length === 0) delete raw.modelAllowlist;
			else raw.modelAllowlist = clean;
		}
		const existing = (raw.modelAliases && typeof raw.modelAliases === "object") ? raw.modelAliases : {};
		// Final aliases = (existing entries NOT managed by models.json) +
		//                 (derived entries — model.name → alias)
		// Keys present in managedKeys but missing from derived (name cleared)
		// are dropped — that's exactly what the user wants.
		const merged: Record<string, string> = {};
		for (const [k, v] of Object.entries(existing)) {
			if (!derived.managedKeys.has(k)) merged[k] = v as string;
		}
		for (const [k, v] of Object.entries(derived.aliasesByKey)) {
			merged[k] = v;
		}
		if (Object.keys(merged).length === 0) delete raw.modelAliases;
		else raw.modelAliases = merged;

		if (!raw.modes || typeof raw.modes !== "object") raw.modes = {};
		const defaults = SettingsPanel.defaultPrompts();
		for (const name of MODE_NAMES) {
			const draft = modes[name];
			if (!draft) continue;
			const existing = raw.modes[name] ?? {};
			const next: any = { ...existing };
			const provider = (draft.provider ?? "").trim();
			const id = (draft.id ?? "").trim();
			if (provider && id) next.model = { provider, id };
			else if (!provider && !id) delete next.model;
			const thinking = (draft.thinking ?? "").trim();
			if (thinking) next.thinkingLevel = thinking;
			else delete next.thinkingLevel;
			// systemPromptAddendum override. The webview sends the effective text
			// (default pre-filled). Treat "empty" or "identical to default" as
			// no override → drop the field so the built-in default applies and
			// modes.json stays clean.
			if (draft.prompt !== undefined) {
				const prompt = draft.prompt;
				const def = defaults[name] ?? "";
				if (prompt.trim() && prompt !== def) next.systemPromptAddendum = prompt;
				else delete next.systemPromptAddendum;
			}
			raw.modes[name] = next;
		}
		SettingsPanel.writeJson(MODES_PATH, raw);
	}

	private static writeAuth(adds: Record<string, string>, removes: string[]): void {
		// Re-read latest to avoid clobbering OAuth tokens added by `pi /login`
		// running in parallel. proper-lockfile would be ideal but adds a dep;
		// read-modify-write is acceptable for single-user manual edits.
		const raw: any = SettingsPanel.readJsonSafe(AUTH_PATH) ?? {};
		for (const id of removes) delete raw[id];
		for (const [id, key] of Object.entries(adds)) {
			if (!id || !key) continue;
			raw[id] = { type: "api_key", key };
		}
		mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
		writeFileSync(AUTH_PATH, JSON.stringify(raw, null, 2), "utf-8");
		try {
			chmodSync(AUTH_PATH, 0o600);
		} catch {
			/* ignore — non-POSIX FS */
		}
	}

	private static writeModels(models: any): void {
		// Preserve any fields the user added manually in models.json that our
		// UI doesn't expose (`compat.thinkingFormat: "qwen-chat-template"`,
		// `headers`, `oauth`, `thinkingLevelMap`, `cost`, etc.). Start from
		// the existing object and only patch the fields we own.
		const next: any = { providers: {} };
		if (models?.providers && typeof models.providers === "object") {
			for (const [name, cfg] of Object.entries(models.providers as any)) {
				if (!name) continue;
				const c = cfg as any;
				// Clone unknown provider-level fields. Drop empty stringy
				// values so we don't write `"baseUrl": ""` etc.
				const provider: any = { ...c };
				delete provider.models;
				if (!c.name) delete provider.name;
				if (!c.baseUrl) delete provider.baseUrl;
				if (!c.apiKey) delete provider.apiKey;
				if (!c.api) delete provider.api;
				if (Array.isArray(c.models) && c.models.length > 0) {
					provider.models = c.models
						.filter((m: any) => m?.id)
						.map((m: any) => {
							// Clone the entire model so user-added `compat`, etc.
							// survive. Then re-assert / clear the fields the UI owns.
							const out: any = { ...m, id: String(m.id).trim() };
							if (!m.name) delete out.name;
							if (m.contextWindow != null && m.contextWindow !== "") {
								out.contextWindow = Number(m.contextWindow);
							} else {
								delete out.contextWindow;
							}
							if (m.maxTokens != null && m.maxTokens !== "") {
								out.maxTokens = Number(m.maxTokens);
							} else {
								delete out.maxTokens;
							}
							if (m.reasoning) out.reasoning = true;
							else delete out.reasoning;
							return out;
						});
				}
				// Skip empty providers (no models AND no overrides worth keeping)
				if (
					provider.models?.length ||
					provider.baseUrl ||
					provider.api ||
					provider.apiKey
				) {
					next.providers[name] = provider;
				}
			}
		}
		SettingsPanel.writeJson(MODELS_PATH, next);
	}

	private static writeJson(path: string, data: any): void {
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		} catch (err) {
			throw new Error(t("settings.writeFailed", { path, err: (err as Error).message }));
		}
	}

	private static html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
		const nonce = makeNonce();
		const csp = buildCsp(webview, nonce);
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "media", "settings.css"),
		);
		const jsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "out", "webview", "settings.js"),
		);
		const i18nLiteral = jsonForScript(getWebviewMessages());
		const locale = resolveLocale();
		const langSetting = vscode.workspace.getConfiguration("hmm-code").get<string>("language", "auto");
		const langOpt = (v: string, label: string) =>
			`<option value="${v}"${langSetting === v ? " selected" : ""}>${label}</option>`;
		return `<!DOCTYPE html>
<html lang="${locale}">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>${t("settings.panelTitle")}</title>
	<link rel="stylesheet" href="${cssUri}" />
</head>
<body>
	<h1>${t("settings.panelTitle")}</h1>
	<div class="subtitle">${t("settings.subtitle")}</div>

	<nav class="tabs">
		<button class="tab-btn" data-tab="general">${t("settings.tab.general")}</button>
		<button class="tab-btn" data-tab="auth">${t("settings.tab.auth")}</button>
		<button class="tab-btn" data-tab="models">${t("settings.tab.models")}</button>
		<button class="tab-btn" data-tab="modes">${t("settings.tab.modes")}</button>
		<button class="tab-btn" data-tab="prompts">${t("settings.tab.prompts")}</button>
	</nav>

	<section class="tab-panel" data-tab="general">
		<div class="section">
			<h2>${t("settings.general.language")}</h2>
			<div class="desc">${t("settings.general.languageDesc")}</div>
			<select id="lang-select">
				${langOpt("auto", t("settings.lang.auto"))}
				${langOpt("en", t("settings.lang.en"))}
				${langOpt("ko", t("settings.lang.ko"))}
			</select>
		</div>

		<div class="section">
			<h2>${t("settings.defaultMode.heading")}</h2>
			<div class="desc">${t("settings.defaultMode.desc")}</div>
			<select id="default-mode">
				${MODE_NAMES.map((m) => `<option value="${m}">${m}</option>`).join("")}
			</select>
		</div>

		<div class="section">
			<h2>${t("settings.autoApprove.heading")}</h2>
			<div class="desc">${t("settings.autoApprove.desc")}</div>
			<label class="toggle-row" for="auto-approve-default" style="margin-top: 6px;">
				<span class="switch">
					<input type="checkbox" id="auto-approve-default" />
					<span class="switch-track"><span class="switch-thumb"></span></span>
				</span>
				<span>${t("settings.autoApprove.label")}</span>
			</label>
		</div>

		<div class="section">
			<h2>${t("settings.autoTitle.heading")}</h2>
			<div class="desc">${t("settings.autoTitle.desc")}</div>
			<div class="mode-card autotitle-card" id="autotitle-card">
				<div class="mode-name" style="color: var(--vscode-foreground);">${t("settings.autoTitle.label")}</div>
				<select id="autotitle-model"></select>
			</div>
		</div>

		<div class="section">
			<h2>${t("settings.compact.heading")}</h2>
			<div class="desc">${t("settings.compact.desc")}</div>
			<label class="toggle-row" for="dynamic-compaction">
				<span class="switch">
					<input type="checkbox" id="dynamic-compaction" />
					<span class="switch-track"><span class="switch-thumb"></span></span>
				</span>
				<span>${t("settings.compact.dynamic")}</span>
			</label>
			<div class="desc field-hint" style="margin-top: 4px;">${t("settings.compact.dynamicDesc")}</div>
				<label class="toggle-row" for="include-old-tool-outputs" style="margin-top: 10px;">
					<span class="switch">
						<input type="checkbox" id="include-old-tool-outputs" />
						<span class="switch-track"><span class="switch-thumb"></span></span>
					</span>
					<span>${t("settings.toolOutputs.include")}</span>
				</label>
				<div class="desc field-hint" style="margin-top: 4px;">${t("settings.toolOutputs.includeDesc")}</div>
				<label class="toggle-row" for="todo-panel-toggle" style="margin-top: 10px;">
					<span class="switch">
						<input type="checkbox" id="todo-panel-toggle" />
						<span class="switch-track"><span class="switch-thumb"></span></span>
					</span>
					<span>${t("settings.todoPanel.label")}</span>
				</label>
				<div class="desc field-hint" style="margin-top: 4px;">${t("settings.todoPanel.desc")}</div>
				<label class="toggle-row" for="auto-continue-compact" style="margin-top: 10px;">
					<span class="switch">
						<input type="checkbox" id="auto-continue-compact" />
						<span class="switch-track"><span class="switch-thumb"></span></span>
					</span>
					<span>${t("settings.autoContinue.label")}</span>
				</label>
				<div class="desc field-hint" style="margin-top: 4px;">${t("settings.autoContinue.desc")}</div>
			<div class="row" style="margin-top: 12px;">
				<input type="range" id="compact-threshold" min="50" max="80" step="1" class="slider" />
				<span class="field-hint slider-value" id="compact-value">75%</span>
				<span class="field-hint" id="compact-default-hint"></span>
				<button class="ghost" id="compact-reset">${t("settings.compact.reset")}</button>
			</div>
			<div class="desc" style="margin-top: 14px;">${t("settings.compactModel.desc")}</div>
			<div class="mode-card autotitle-card" id="compactmodel-card">
				<div class="mode-name" style="color: var(--vscode-foreground);">${t("settings.compactModel.label")}</div>
				<select id="compactmodel-model"></select>
			</div>
		</div>

		<div class="section">
			<h2>${t("settings.retention.heading")}</h2>
			<div class="desc">${t("settings.retention.desc")}</div>
			<div class="row" style="margin-top: 8px;">
				<input type="number" id="artifact-retention" min="0" max="3650" step="1" style="width: 90px; flex: none;" />
				<span class="field-hint">${t("settings.retention.daysHint")}</span>
			</div>
		</div>
	</section>

	<section class="tab-panel" data-tab="auth">
		<div class="section">
			<h2>${t("settings.auth.heading")}</h2>
			<div class="desc">${t("settings.auth.desc")}</div>
			<table id="auth-table">
				<thead><tr><th>${t("settings.auth.colProvider")}</th><th>${t("settings.auth.colType")}</th><th></th></tr></thead>
				<tbody id="auth-body"><tr><td colspan="3"><em>${t("settings.auth.loading")}</em></td></tr></tbody>
			</table>
			<datalist id="provider-ids">
				<option value="anthropic"></option>
				<option value="openai"></option>
				<option value="google"></option>
				<option value="google-vertex"></option>
				<option value="xai"></option>
				<option value="groq"></option>
				<option value="deepseek"></option>
				<option value="mistral"></option>
				<option value="moonshotai"></option>
				<option value="together"></option>
				<option value="openrouter"></option>
				<option value="fireworks"></option>
				<option value="cerebras"></option>
			</datalist>
			<div class="row" style="margin-top: 12px;">
				<input type="text" id="new-auth-id" list="provider-ids" placeholder="${t("settings.auth.idPlaceholder")}" />
				<input type="password" id="new-auth-key" placeholder="${t("settings.auth.keyPlaceholder")}" style="max-width: 240px;" />
				<button id="add-auth-btn">${t("settings.auth.addBtn")}</button>
			</div>
			<div class="note" style="margin-top: 12px;">
				<strong>${t("settings.auth.oauthTitle")}</strong>
				<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
					<span style="font-size: 11px; min-width: 88px;">Claude Pro/Max</span>
					<button id="anthropic-login-btn">${t("settings.auth.claudeLogin")}</button>
					<button class="ghost hidden" id="anthropic-cancel-btn">${t("settings.cancel")}</button>
					<button class="ghost hidden" id="anthropic-usage-btn">${t("settings.usage.check")}</button>
					<span id="anthropic-status" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></span>
				</div>
				<div id="anthropic-usage" class="oauth-usage hidden"></div>
				<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
					<span style="font-size: 11px; min-width: 88px;">ChatGPT Plus/Pro</span>
					<button id="codex-login-btn">${t("settings.auth.codexLogin")}</button>
					<button class="ghost hidden" id="codex-cancel-btn">${t("settings.cancel")}</button>
					<button class="ghost hidden" id="codex-usage-btn">${t("settings.usage.check")}</button>
					<span id="codex-status" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></span>
				</div>
				<div id="codex-usage" class="oauth-usage hidden"></div>
			</div>
		</div>

		<div class="section">
			<h2>${t("settings.providers.heading")}</h2>
			<div class="desc">${t("settings.providers.headingDesc")}</div>
			<div id="providers-list"></div>
			<button id="add-provider-btn" class="ghost" style="margin-top: 10px;">${t("settings.providers.addProvider")}</button>
		</div>
	</section>

	<section class="tab-panel" data-tab="models">
		<div class="section">
			<h2>${t("settings.filter.heading")}</h2>
			<div class="desc">${t("settings.filter.desc")}</div>
			<div id="allowlist-cards"></div>
		</div>
	</section>

	<section class="tab-panel" data-tab="modes">
		<div class="section">
			<h2>${t("settings.modes.heading")}</h2>
			<div class="desc">${t("settings.modes.desc")}</div>
			<div id="mode-cards"></div>
		</div>
	</section>

	<section class="tab-panel" data-tab="prompts">
		<div class="section">
			<h2>${t("settings.prompts.modesHeading")}</h2>
			<div class="desc">${t("settings.prompts.modesDesc")}</div>
			<div id="prompt-modes"></div>
		</div>
		<div class="section">
			<h2>${t("settings.prompts.autoTitleHeading")}</h2>
			<div class="desc">${t("settings.prompts.autoTitleDesc")}</div>
			<div class="prompt-block">
				<div class="mode-prompt-head">
					<span class="mode-name">${t("settings.prompts.autoTitleName")}</span>
					<span class="mode-prompt-badge hidden" id="autotitle-badge">${t("settings.modes.promptCustom")}</span>
					<span class="spacer"></span>
					<button class="ghost" id="autotitle-prompt-reset">${t("settings.modes.resetDefault")}</button>
				</div>
				<textarea id="autotitle-prompt-ta" class="mode-prompt-ta" rows="10" spellcheck="false" placeholder="${t("settings.prompts.autoTitlePlaceholder")}"></textarea>
			</div>
		</div>
		<div class="section">
			<h2>${t("settings.prompts.compactHeading")}</h2>
			<div class="desc">${t("settings.prompts.compactDesc")}</div>
			<div class="prompt-block">
				<div class="mode-prompt-head">
					<span class="mode-name">${t("settings.prompts.compactName")}</span>
					<span class="mode-prompt-badge hidden" id="compact-badge">${t("settings.modes.promptCustom")}</span>
					<span class="spacer"></span>
					<button class="ghost" id="compact-instructions-reset">${t("settings.prompts.clear")}</button>
				</div>
				<textarea id="compact-instructions-ta" class="mode-prompt-ta" rows="10" spellcheck="false" placeholder="${t("settings.prompts.compactPlaceholder")}"></textarea>
			</div>
		</div>
	</section>

	<div class="toast hidden" id="toast"></div>

	<div class="save-bar hidden" id="save-bar">
		<span class="dirty-label">${t("settings.save.dirty")}<small id="dirty-detail"></small></span>
		<button class="ghost" id="cancel-btn">${t("settings.cancel")}</button>
		<button id="save-btn">${t("settings.save.button")}</button>
	</div>

	<script nonce="${nonce}">window.__HMM_I18N = ${i18nLiteral};</script>
	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
	}
}

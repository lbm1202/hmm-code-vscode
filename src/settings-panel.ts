// Standalone settings panel — direct file editor for Pi config.
//
// Inline editing (no chat dispatch):
//   - modes.json  → per-mode model + thinking, modelAliases
//   - auth.json   → API-key credentials (add/remove). OAuth providers
//                   (anthropic, github-copilot, openai-codex) need the
//                   pi-ai/oauth browser flow — shown with terminal guidance.
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
import { codexOAuthLogin } from "./oauth-codex";
import { anthropicOAuthLogin } from "./oauth-anthropic";
import { buildCsp, makeNonce } from "./webview-html";

const VIEW_TYPE = "hmm-code.settingsPanel";
const PI_DIR = join(homedir(), ".pi", "agent");
const MODES_PATH = join(PI_DIR, "modes.json");
const MODELS_PATH = join(PI_DIR, "models.json");
const AUTH_PATH = join(PI_DIR, "auth.json");
const SETTINGS_PATH = join(PI_DIR, "settings.json");

const MODE_NAMES = ["plan", "code", "debug", "ask"] as const;
// OAuth-only providers — auth.json entries need a browser redirect flow that
// belongs in the pi-ai/oauth package. Anthropic/GitHub-Copilot also work but
// the user only cares about Codex subscription auth here.
const OAUTH_PROVIDERS: { id: string; name: string }[] = [
	{ id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)" },
];
// Common OpenAI-compatible API types Pi understands.
const API_TYPES = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
];

export class SettingsPanel {
	public static readonly viewType = VIEW_TYPE;
	private static instance: vscode.WebviewPanel | undefined;
	/** In-flight OAuth login (codex/anthropic) — process-global single-flight,
	 *  aborted on panel dispose so the callback server can't leak. */
	private static _oauthLoginAbort: AbortController | undefined;

	static open(ctx: vscode.ExtensionContext): void {
		if (SettingsPanel.instance) {
			SettingsPanel.instance.reveal(vscode.ViewColumn.Active);
			SettingsPanel.refresh(SettingsPanel.instance);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			"Hmm-code 설정",
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
		};
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
		panel.webview.postMessage({ kind: opts.statusKind, state: "starting", message: "OAuth 플로우 시작…" });
		try {
			const creds = await opts.run(
				{
					onAuth: ({ url, instructions }) => {
						vscode.env.openExternal(vscode.Uri.parse(url));
						panel.webview.postMessage({
							kind: opts.statusKind,
							state: "browser",
							url,
							message: instructions ?? "브라우저에서 로그인 진행 중…",
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
				message: `${opts.label} 인증 저장됨 + 채팅 재시작.`,
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
			case "codex-login": {
				await SettingsPanel.runOAuthLogin(panel, {
					statusKind: "codex-status",
					providerId: "openai-codex",
					label: "openai-codex",
					run: codexOAuthLogin,
				});
				return;
			}
			case "anthropic-login": {
				await SettingsPanel.runOAuthLogin(panel, {
					statusKind: "anthropic-status",
					providerId: "anthropic",
					label: "anthropic (Claude Pro/Max)",
					run: anthropicOAuthLogin,
				});
				return;
			}
			case "codex-login-cancel":
			case "anthropic-login-cancel": {
				SettingsPanel._oauthLoginAbort?.abort?.();
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
						error: "baseUrl 이 비어있습니다.",
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
		modes: Record<string, { provider?: string; id?: string; thinking?: string }>,
		autoTitle?: { provider?: string; id?: string } | null,
		modelAllowlist?: Record<string, string[]> | null,
	): void {
		let raw: any = SettingsPanel.readJsonSafe(MODES_PATH) ?? {};
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
			throw new Error(`${path} 쓰기 실패: ${(err as Error).message}`);
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
		return `<!DOCTYPE html>
<html lang="ko">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>Hmm-code 설정</title>
	<link rel="stylesheet" href="${cssUri}" />
</head>
<body>
	<h1>Hmm-code 설정</h1>
	<div class="subtitle">모드 · 모델 · 별명 · 인증 · 커스텀 공급자</div>

	<div class="section">
		<h2>모드</h2>
		<div class="desc">각 모드별 모델 (provider + id) 과 thinking level. 빈 값으로 두면 default 사용.</div>
		<div id="mode-cards"></div>
	</div>

	<div class="section">
		<h2>기타 모델 설정</h2>
		<div class="desc">
			세션 자동 제목 생성에 사용할 모델. <strong>빈 값이면 현재 세션의 활성 모델</strong>을 사용합니다 (대화 중인 모델과 동일 — 별도 provider 인증 불필요). 전용 모델을 쓰려면 여기서 지정하세요.
			컨텍스트 요약(compact)은 Pi 가 항상 <strong>현재 활성 모델</strong>을 사용 — 별도 설정 불가.
		</div>
		<div class="mode-card autotitle-card" id="autotitle-card">
			<div class="mode-name" style="color: var(--vscode-foreground);">자동 제목</div>
			<select id="autotitle-provider"></select>
			<select id="autotitle-id"></select>
		</div>
	</div>

	<div class="section">
		<h2>공급자별 모델 필터</h2>
		<div class="desc">
			모델 picker 에 보일 모델을 공급자별로 선택. 전부 체크되어 있으면 필터 없음(전체 노출). 일부만 체크하면 그 모델들만 picker 에 보임.
			위쪽 모드 설정 / 자동 제목 dropdown 도 동일하게 필터링됨 (이미 선택된 hidden 모델은 유지).
		</div>
		<div id="allowlist-cards"></div>
	</div>

	<div class="section">
		<h2>공급자 인증 (auth.json)</h2>
		<div class="desc">
			<strong>API key</strong>: built-in 공급자 id + key 만 넣으면 됩니다 (커스텀 공급자 등록 불필요).
			예) <code>anthropic</code>=Claude, <code>openai</code>=OpenAI, <code>google</code>=Gemini,
			<code>xai</code>=Grok, <code>groq</code>, <code>deepseek</code>, <code>openrouter</code> …<br />
			<strong>구독제(OAuth)</strong>: 아래 버튼으로 브라우저 로그인.
		</div>
		<table id="auth-table">
			<thead><tr><th>Provider</th><th>Type</th><th></th></tr></thead>
			<tbody id="auth-body"><tr><td colspan="3"><em>로딩 중…</em></td></tr></tbody>
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
			<input type="text" id="new-auth-id" list="provider-ids" placeholder="provider id (anthropic, openai, google, groq …)" />
			<input type="password" id="new-auth-key" placeholder="API key (sk-...)" style="max-width: 240px;" />
			<button id="add-auth-btn">추가 (draft)</button>
		</div>
		<div class="note" style="margin-top: 12px;">
			<strong>구독제 OAuth (브라우저 로그인)</strong>
			<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
				<span style="font-size: 11px; min-width: 88px;">ChatGPT Plus/Pro</span>
				<button id="codex-login-btn">Codex 로그인</button>
				<button class="ghost hidden" id="codex-cancel-btn">취소</button>
				<span id="codex-status" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></span>
			</div>
			<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
				<span style="font-size: 11px; min-width: 88px;">Claude Pro/Max</span>
				<button id="anthropic-login-btn">Claude 로그인</button>
				<button class="ghost hidden" id="anthropic-cancel-btn">취소</button>
				<span id="anthropic-status" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></span>
			</div>
		</div>
	</div>

	<div class="section">
		<h2>커스텀 공급자 / 모델 (models.json)</h2>
		<div class="desc">
			OpenAI-호환 endpoint (vLLM, Ollama, LM Studio, OpenRouter, 자체 호스팅 등) 를 등록합니다.
			Built-in provider 의 모델은 자동 인식되므로 여기 등록할 필요 없습니다.
		</div>
		<div id="providers-list"></div>
		<button id="add-provider-btn" class="ghost" style="margin-top: 10px;">+ 공급자 추가</button>
	</div>

	<div class="toast hidden" id="toast"></div>

	<div class="save-bar hidden" id="save-bar">
		<span class="dirty-label">변경사항 있음<small id="dirty-detail"></small></span>
		<button class="ghost" id="cancel-btn">취소</button>
		<button id="save-btn">저장 + 재로드</button>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
	}
}

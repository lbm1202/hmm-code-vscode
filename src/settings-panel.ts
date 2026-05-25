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
import { codexOAuthLogin } from "./oauth-codex";

const VIEW_TYPE = "hmm-code.settingsPanel";
const PI_DIR = join(homedir(), ".pi", "agent");
const MODES_PATH = join(PI_DIR, "modes.json");
const MODELS_PATH = join(PI_DIR, "models.json");
const AUTH_PATH = join(PI_DIR, "auth.json");
const SETTINGS_PATH = join(PI_DIR, "settings.json");

const MODE_NAMES = ["plan", "code", "debug", "ask"] as const;
const THINKING_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
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
				localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
			},
		);
		SettingsPanel.attach(panel, ctx);
	}

	static adopt(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
		};
		SettingsPanel.attach(panel, ctx);
	}

	private static attach(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "tab-icon.svg");
		panel.webview.html = SettingsPanel.html(panel.webview);
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

		panel.onDidDispose(() => {
			if (SettingsPanel.instance === panel) SettingsPanel.instance = undefined;
		});

		setTimeout(() => SettingsPanel.refresh(panel), 50);
	}

	private static refresh(panel: vscode.WebviewPanel): void {
		panel.webview.postMessage({
			kind: "state",
			state: SettingsPanel.readState(),
		});
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
		return {
			modesPath: MODES_PATH,
			modelsPath: MODELS_PATH,
			authPath: AUTH_PATH,
			settingsPath: SETTINGS_PATH,
			modes,
			auth: authSafe,
			models,
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

	private static async handleMessage(panel: vscode.WebviewPanel, msg: any): Promise<void> {
		switch (msg?.kind) {
			case "open-file": {
				const path = String(msg.path ?? "");
				if (!path || !existsSync(path)) {
					vscode.window.showWarningMessage(`파일이 없습니다: ${path}`);
					return;
				}
				const doc = await vscode.workspace.openTextDocument(path);
				await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
				return;
			}
			case "open-terminal-login": {
				const t = vscode.window.createTerminal({ name: "Hmm-code: pi /login" });
				t.show();
				t.sendText("pi", true);
				vscode.window.showInformationMessage(
					"터미널에서 /login 입력 후 OAuth provider 를 선택하세요.",
				);
				return;
			}
			case "codex-login": {
				// Run the inline OAuth flow. Single-flight: ignore if already running.
				if ((SettingsPanel as any)._codexLoginAbort) {
					panel.webview.postMessage({ kind: "codex-status", state: "running" });
					return;
				}
				const abort = new AbortController();
				(SettingsPanel as any)._codexLoginAbort = abort;
				panel.webview.postMessage({ kind: "codex-status", state: "starting", message: "OAuth 플로우 시작…" });
				try {
					const creds = await codexOAuthLogin(
						{
							onAuth: ({ url, instructions }) => {
								vscode.env.openExternal(vscode.Uri.parse(url));
								panel.webview.postMessage({
									kind: "codex-status",
									state: "browser",
									url,
									message: instructions ?? "브라우저에서 로그인 진행 중…",
								});
							},
							onProgress: (message) => {
								panel.webview.postMessage({ kind: "codex-status", state: "progress", message });
							},
						},
						abort.signal,
					);
					// Write to auth.json with shape Pi's AuthStorage expects
					const raw: any = SettingsPanel.readJsonSafe(AUTH_PATH) ?? {};
					raw["openai-codex"] = creds;
					mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
					writeFileSync(AUTH_PATH, JSON.stringify(raw, null, 2), "utf-8");
					try { chmodSync(AUTH_PATH, 0o600); } catch { /* non-POSIX */ }
					vscode.commands.executeCommand("hmm-code.sendSlash", "/reload-runtime");
					panel.webview.postMessage({
						kind: "codex-status",
						state: "success",
						message: "openai-codex 인증 저장됨. 새 채팅에서 사용 가능합니다.",
					});
					SettingsPanel.refresh(panel);
				} catch (err) {
					panel.webview.postMessage({
						kind: "codex-status",
						state: "error",
						message: (err as Error).message,
					});
				} finally {
					(SettingsPanel as any)._codexLoginAbort = undefined;
				}
				return;
			}
			case "codex-login-cancel": {
				(SettingsPanel as any)._codexLoginAbort?.abort?.();
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
					SettingsPanel.writeModes(derived, msg.modeConfigs ?? {});
					if (!out.includes("modes.json")) out.push("modes.json");
				}
				if (msg.authAdds || msg.authRemoves) {
					SettingsPanel.writeAuth(msg.authAdds ?? {}, msg.authRemoves ?? []);
					out.push("auth.json");
				}
				if (out.length > 0) {
					vscode.commands.executeCommand("hmm-code.sendSlash", "/reload-runtime");
				}
				SettingsPanel.refresh(panel);
				panel.webview.postMessage({ kind: "saved", files: out });
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
	): void {
		let raw: any = SettingsPanel.readJsonSafe(MODES_PATH) ?? {};
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
		// Full replacement of providers dict. The webview sends the entire
		// edited state, so we trust it as the new source of truth.
		const next: any = { providers: {} };
		if (models?.providers && typeof models.providers === "object") {
			for (const [name, cfg] of Object.entries(models.providers as any)) {
				if (!name) continue;
				const c = cfg as any;
				const provider: any = {};
				if (c.name) provider.name = c.name;
				if (c.baseUrl) provider.baseUrl = c.baseUrl;
				if (c.apiKey) provider.apiKey = c.apiKey;
				if (c.api) provider.api = c.api;
				if (Array.isArray(c.models) && c.models.length > 0) {
					provider.models = c.models
						.filter((m: any) => m?.id)
						.map((m: any) => {
							const out: any = { id: String(m.id).trim() };
							if (m.name) out.name = m.name;
							if (m.contextWindow != null && m.contextWindow !== "") out.contextWindow = Number(m.contextWindow);
							if (m.maxTokens != null && m.maxTokens !== "") out.maxTokens = Number(m.maxTokens);
							if (m.reasoning) out.reasoning = true;
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

	private static html(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const csp = [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			"font-src 'self'",
			`img-src ${webview.cspSource} data:`,
		].join("; ");
		const thinkingOpts = THINKING_LEVELS
			.map((l) => `<option value="${l}">${l || "(default)"}</option>`)
			.join("");
		const apiTypeOpts = API_TYPES
			.map((t) => `<option value="${t}">${t}</option>`)
			.join("");
		return `<!DOCTYPE html>
<html lang="ko">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>Hmm-code 설정</title>
	<style>${SETTINGS_CSS}</style>
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
		<h2>공급자 인증 (auth.json)</h2>
		<div class="desc">
			API key 는 인라인으로 추가. OAuth (openai-codex) 는 브라우저 로그인 흐름이 자동으로 뜹니다.
		</div>
		<table id="auth-table">
			<thead><tr><th>Provider</th><th>Type</th><th></th></tr></thead>
			<tbody id="auth-body"><tr><td colspan="3"><em>로딩 중…</em></td></tr></tbody>
		</table>
		<div class="row" style="margin-top: 12px;">
			<input type="text" id="new-auth-id" placeholder="provider id (e.g. openai, anthropic, groq)" />
			<input type="password" id="new-auth-key" placeholder="API key (sk-...)" style="max-width: 240px;" />
			<button id="add-auth-btn">추가 (draft)</button>
		</div>
		<div class="note" style="margin-top: 12px;">
			<strong>OpenAI Codex (ChatGPT Plus/Pro) OAuth</strong>
			<div style="margin-top: 6px; display: flex; gap: 8px; align-items: center;">
				<button id="codex-login-btn">브라우저 로그인</button>
				<button class="ghost hidden" id="codex-cancel-btn">취소</button>
				<span id="codex-status" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></span>
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

	<script nonce="${nonce}">
		${SETTINGS_JS_PREAMBLE}
		const THINKING_HTML = \`${thinkingOpts}\`;
		const API_TYPE_HTML = \`${apiTypeOpts}\`;
		${SETTINGS_JS_BODY}
	</script>
</body>
</html>`;
	}
}

function makeNonce(): string {
	let out = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
	return out;
}

// ── CSS extracted to keep the html() function manageable ─────────────────────
const SETTINGS_CSS = `
* { box-sizing: border-box; }
body {
	font-family: var(--vscode-font-family);
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	padding: 24px 32px 110px 32px;
	margin: 0;
	line-height: 1.5;
}
h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px 0; }
.subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 28px; }
.section {
	background: var(--vscode-editorWidget-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 18px 20px;
	margin-bottom: 18px;
}
.section h2 { font-size: 14px; font-weight: 600; margin: 0 0 4px 0; }
.section .desc { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 14px 0; }
.row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.path {
	font-family: var(--vscode-editor-font-family);
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
button {
	font-family: var(--vscode-font-family);
	font-size: 12px;
	padding: 5px 12px;
	border-radius: 3px;
	border: 1px solid var(--vscode-button-border, transparent);
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.ghost {
	background: transparent;
	color: var(--vscode-foreground);
	border-color: var(--vscode-panel-border);
}
button.ghost:hover { background: var(--vscode-list-hoverBackground); }
button.danger {
	background: transparent;
	color: var(--vscode-errorForeground);
	border-color: var(--vscode-panel-border);
}
button.danger:hover { background: var(--vscode-inputValidation-errorBackground, var(--vscode-list-hoverBackground)); }
input[type="text"], input[type="password"], input[type="number"], select {
	font-family: var(--vscode-editor-font-family);
	font-size: 12px;
	padding: 5px 8px;
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
	border-radius: 3px;
}
input[type="text"], input[type="password"] { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td {
	text-align: left;
	padding: 6px 10px;
	border-bottom: 1px solid var(--vscode-panel-border);
}
th {
	font-weight: 600;
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}
.alias-row td, .auth-row td { font-family: var(--vscode-editor-font-family); }
.alias-row td:last-child, .auth-row td:last-child { width: 60px; text-align: right; }
.alias-row.dirty, .auth-row.dirty {
	background: color-mix(in srgb, var(--vscode-editorInfo-foreground, var(--vscode-focusBorder)) 8%, transparent);
}
.mode-card {
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	padding: 12px 14px;
	margin-bottom: 8px;
	display: grid;
	grid-template-columns: 60px 1fr 1fr 130px;
	gap: 10px;
	align-items: center;
}
.mode-card.dirty {
	border-color: var(--vscode-focusBorder);
	background: color-mix(in srgb, var(--vscode-editorInfo-foreground, var(--vscode-focusBorder)) 6%, transparent);
}
.mode-name { font-weight: 600; font-size: 13px; }
.mode-name.plan { color: rgb(120, 170, 255); }
.mode-name.code { color: var(--vscode-foreground); }
.mode-name.debug { color: rgb(200, 140, 240); }
.mode-name.ask { color: rgb(255, 180, 100); }
.provider-card {
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 18px 20px;
	margin-bottom: 14px;
}
.provider-card.dirty {
	border-color: var(--vscode-focusBorder);
	background: color-mix(in srgb, var(--vscode-editorInfo-foreground, var(--vscode-focusBorder)) 5%, transparent);
}
.provider-card .card-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 4px;
}
.provider-card .card-title {
	font-size: 13px; font-weight: 600;
}
.provider-card .card-sub {
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	margin: 0 0 14px 0;
}
.field { margin-bottom: 14px; }
.field label {
	display: block;
	font-size: 12px;
	font-weight: 500;
	margin-bottom: 4px;
	color: var(--vscode-foreground);
}
.field .field-hint {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin-top: 4px;
}
.field input[type="text"], .field input[type="password"] {
	width: 100%;
}
.subsection-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin: 14px 0 8px 0;
}
.subsection-header h3 {
	font-size: 13px; font-weight: 600;
	margin: 0;
}
.model-grid {
	display: grid;
	grid-template-columns: 60px 1fr 1fr 40px;
	gap: 8px;
	margin-bottom: 4px;
}
.model-grid .label {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}
.model-row-card {
	display: grid;
	grid-template-columns: 60px 1fr 1fr 40px;
	gap: 8px;
	align-items: center;
	margin: 4px 0;
}
.model-row-card .row-num {
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	text-align: center;
}
.disc-picker {
	margin-top: 10px;
	border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
	border-radius: 6px;
	padding: 14px;
	background: var(--vscode-editor-background);
}
.disc-picker .disc-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}
.disc-picker .disc-title { font-size: 12px; font-weight: 600; }
.disc-picker .disc-actions { display: flex; gap: 12px; }
.disc-picker .disc-actions button {
	background: transparent;
	color: var(--vscode-textLink-foreground);
	border: none;
	padding: 0;
	font-size: 12px;
	cursor: pointer;
}
.disc-picker .disc-search { width: 100%; margin-bottom: 8px; }
.disc-picker .disc-list {
	max-height: 280px;
	overflow-y: auto;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	padding: 4px 0;
}
.disc-picker .disc-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	font-family: var(--vscode-editor-font-family);
	font-size: 12px;
	cursor: pointer;
}
.disc-picker .disc-item:hover { background: var(--vscode-list-hoverBackground); }
.disc-picker .disc-item input { margin: 0; }
.disc-picker .disc-footer {
	display: flex;
	gap: 8px;
	margin-top: 10px;
}
.disc-picker .disc-empty {
	padding: 12px;
	text-align: center;
	color: var(--vscode-descriptionForeground);
	font-size: 12px;
}
.toast {
	position: fixed;
	top: 20px; right: 20px;
	background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
	color: var(--vscode-notifications-foreground, var(--vscode-foreground));
	border: 1px solid var(--vscode-notifications-border, var(--vscode-panel-border));
	border-radius: 4px;
	padding: 10px 14px;
	font-size: 12px;
	box-shadow: 0 4px 12px rgba(0,0,0,0.3);
	z-index: 1000;
}
.toast.error { border-color: var(--vscode-errorForeground); }
.toast.hidden { display: none; }
.note {
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	margin-top: 6px;
	padding: 8px 10px;
	background: color-mix(in srgb, var(--vscode-editorWidget-background) 60%, transparent);
	border-left: 2px solid var(--vscode-panel-border);
}
.save-bar {
	position: fixed;
	bottom: 20px; right: 24px;
	background: var(--vscode-editorWidget-background);
	border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border));
	border-radius: 6px;
	padding: 10px 14px;
	display: flex;
	gap: 10px;
	align-items: center;
	box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
	z-index: 1000;
}
.save-bar.hidden { display: none; }
.save-bar .dirty-label { font-size: 12px; font-weight: 500; }
.save-bar .dirty-label small {
	color: var(--vscode-descriptionForeground);
	font-weight: 400;
	margin-left: 6px;
}
`;

const SETTINGS_JS_PREAMBLE = `
const vscode = acquireVsCodeApi();
const post = (msg) => vscode.postMessage(msg);
const MODE_NAMES = ${JSON.stringify(MODE_NAMES)};
`;

const SETTINGS_JS_BODY = `
let diskState = null;
let modesDraft = {};
let authAddsDraft = {};           // provider id -> key (new ones to add)
let authRemovesDraft = new Set(); // provider ids to remove
let modelsDraft = { providers: {} };

function showToast(text, isError) {
	const t = document.getElementById('toast');
	t.textContent = text;
	t.classList.toggle('error', !!isError);
	t.classList.remove('hidden');
	setTimeout(() => t.classList.add('hidden'), 2500);
}
function esc(s) {
	return String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function diskMode(name) {
	const cfg = (diskState && diskState.modes && diskState.modes.modes && diskState.modes.modes[name]) || {};
	const m = cfg.model;
	const isObj = m && typeof m === 'object';
	return {
		provider: isObj ? (m.provider || '') : '',
		id: isObj ? (m.id || '') : '',
		thinking: cfg.thinkingLevel || '',
	};
}
function diskAuth() { return (diskState && diskState.auth) || {}; }
function diskModels() {
	const m = diskState && diskState.models;
	return (m && typeof m === 'object' && m.providers) ? m : { providers: {} };
}

function modeDirty(name) {
	const d = diskMode(name);
	const draft = modesDraft[name] || { provider: '', id: '', thinking: '' };
	return d.provider !== draft.provider || d.id !== draft.id || d.thinking !== draft.thinking;
}
function authDirty() {
	return Object.keys(authAddsDraft).length > 0 || authRemovesDraft.size > 0;
}
function modelsDirty() {
	return JSON.stringify(modelsDraft) !== JSON.stringify(diskModels());
}

function isDirty() {
	if (!diskState) return false;
	for (const n of MODE_NAMES) if (modeDirty(n)) return true;
	if (authDirty()) return true;
	if (modelsDirty()) return true;
	return false;
}

function updateSaveBar() {
	const dirty = isDirty();
	document.getElementById('save-bar').classList.toggle('hidden', !dirty);
	if (!dirty) return;
	let modeD = 0, authD = 0;
	for (const n of MODE_NAMES) if (modeDirty(n)) modeD++;
	authD = Object.keys(authAddsDraft).length + authRemovesDraft.size;
	const parts = [];
	if (modeD) parts.push(modeD + '개 모드');
	if (authD) parts.push(authD + '개 인증');
	if (modelsDirty()) parts.push('커스텀 공급자');
	document.getElementById('dirty-detail').textContent = parts.length ? ' (' + parts.join(' · ') + ')' : '';
}

function renderModes() {
	const root = document.getElementById('mode-cards');
	root.innerHTML = '';
	for (const name of MODE_NAMES) {
		const draft = modesDraft[name];
		const card = document.createElement('div');
		card.className = 'mode-card' + (modeDirty(name) ? ' dirty' : '');
		card.innerHTML =
			'<div class="mode-name ' + name + '">' + name + '</div>' +
			'<input type="text" placeholder="provider (e.g. openai-codex)" value="' + esc(draft.provider) + '" data-mode="' + name + '" data-field="provider" />' +
			'<input type="text" placeholder="id (e.g. gpt-5.5)" value="' + esc(draft.id) + '" data-mode="' + name + '" data-field="id" />' +
			'<select data-mode="' + name + '" data-field="thinking">' + THINKING_HTML + '</select>';
		root.appendChild(card);
		card.querySelector('select').value = draft.thinking;
	}
	root.querySelectorAll('input, select').forEach((el) => {
		el.addEventListener('input', () => {
			const name = el.getAttribute('data-mode');
			const field = el.getAttribute('data-field');
			if (!name || !field || !modesDraft[name]) return;
			modesDraft[name][field] = el.value;
			const card = el.closest('.mode-card');
			if (card) card.classList.toggle('dirty', modeDirty(name));
			updateSaveBar();
		});
	});
}

function renderAuth() {
	const body = document.getElementById('auth-body');
	body.innerHTML = '';
	const onDisk = diskAuth();
	// Combined view: existing (minus pending removes) + pending adds
	const entries = [];
	for (const [id, info] of Object.entries(onDisk)) {
		if (authRemovesDraft.has(id)) continue;
		entries.push({ id, type: info.type, pending: false });
	}
	for (const id of Object.keys(authAddsDraft)) {
		entries.push({ id, type: 'api_key', pending: true });
	}
	// Also show removed entries grayed (so user can undo)
	const removedEntries = [];
	for (const id of authRemovesDraft) {
		removedEntries.push({ id, type: (onDisk[id] && onDisk[id].type) || '?' });
	}

	if (entries.length === 0 && removedEntries.length === 0) {
		body.innerHTML = '<tr><td colspan="3"><em>인증된 공급자 없음</em></td></tr>';
		return;
	}
	for (const e of entries) {
		const tr = document.createElement('tr');
		tr.className = 'auth-row' + (e.pending ? ' dirty' : '');
		tr.innerHTML =
			'<td>' + esc(e.id) + (e.pending ? ' <small style="color: var(--vscode-descriptionForeground)">(draft)</small>' : '') + '</td>' +
			'<td>' + esc(e.type) + '</td>' +
			'<td><button class="danger" data-del-auth="' + esc(e.id) + '">✕</button></td>';
		body.appendChild(tr);
	}
	for (const e of removedEntries) {
		const tr = document.createElement('tr');
		tr.className = 'auth-row dirty';
		tr.innerHTML =
			'<td><s>' + esc(e.id) + '</s> <small style="color: var(--vscode-errorForeground)">(삭제 예정)</small></td>' +
			'<td>' + esc(e.type) + '</td>' +
			'<td><button class="ghost" data-undo-auth="' + esc(e.id) + '">↶</button></td>';
		body.appendChild(tr);
	}
	body.querySelectorAll('button[data-del-auth]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-del-auth');
			if (!id) return;
			if (authAddsDraft[id]) delete authAddsDraft[id];
			else authRemovesDraft.add(id);
			renderAuth();
			updateSaveBar();
		});
	});
	body.querySelectorAll('button[data-undo-auth]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const id = btn.getAttribute('data-undo-auth');
			if (!id) return;
			authRemovesDraft.delete(id);
			renderAuth();
			updateSaveBar();
		});
	});
}

// Each provider card stays expanded with form fields matching the reference UX:
// 공급자 ID / 표시 이름 / 기본 URL / API 키 + 모델 목록 + 모델 발견.
// The "discovery" feature queries baseUrl/models (OpenAI-compatible) and shows
// a checkbox picker for bulk-add.
const discoveryState = {};  // providerName -> { ids: [], filter: '', selected: Set, loading: false, error: '' }

function provDirty(name) {
	const onDisk = diskModels();
	const a = (onDisk.providers && onDisk.providers[name]) || null;
	const b = (modelsDraft.providers && modelsDraft.providers[name]) || null;
	return JSON.stringify(a) !== JSON.stringify(b);
}

function renderProviders() {
	const root = document.getElementById('providers-list');
	root.innerHTML = '';
	const providers = (modelsDraft && modelsDraft.providers) || {};
	const entries = Object.entries(providers);
	if (entries.length === 0) {
		root.innerHTML = '<div class="note">등록된 커스텀 공급자 없음. 아래 "+ 공급자 추가" 로 시작하세요.</div>';
		return;
	}
	for (const [name, cfg] of entries) {
		const card = document.createElement('div');
		card.className = 'provider-card' + (provDirty(name) ? ' dirty' : '');
		card.dataset.prov = name;
		card.innerHTML =
			'<div class="card-header">' +
				'<div class="card-title">✦ 공급자 편집</div>' +
				'<button class="danger" data-del-prov>제거</button>' +
			'</div>' +
			'<p class="card-sub">OpenAI 호환 공급자를 구성합니다. Pi 의 models.json 스키마를 따릅니다.</p>' +
			'<div class="field">' +
				'<label>공급자 ID</label>' +
				'<input type="text" data-field="__name" value="' + esc(name) + '" placeholder="my-vllm" />' +
				'<div class="field-hint">소문자, 숫자, 하이픈 또는 밑줄</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>표시 이름</label>' +
				'<input type="text" data-field="name" value="' + esc(cfg.name || '') + '" placeholder="' + esc(name) + '" />' +
			'</div>' +
			'<div class="field">' +
				'<label>기본 URL</label>' +
				'<input type="text" data-field="baseUrl" value="' + esc(cfg.baseUrl || '') + '" placeholder="https://api.example.com/v1" />' +
			'</div>' +
			'<div class="field">' +
				'<label>API 키</label>' +
				'<input type="password" data-field="apiKey" value="' + esc(cfg.apiKey || '') + '" placeholder="sk-..." />' +
				'<div class="field-hint">선택사항. 환경변수나 헤더로 인증을 관리하는 경우 비워두세요.</div>' +
			'</div>' +
			'<div class="field">' +
				'<label>API 타입</label>' +
				'<select data-field="api">' + API_TYPE_HTML + '<option value="">(auto)</option></select>' +
				'<div class="field-hint">대부분의 OpenAI-호환 endpoint 는 openai-completions.</div>' +
			'</div>' +
			'<div class="subsection-header">' +
				'<h3>모델</h3>' +
				'<button class="ghost" data-discover>모델 발견</button>' +
			'</div>' +
			'<div data-models-area></div>' +
			'<button class="ghost" data-add-model style="margin-top: 8px;">+ 수동 추가</button>' +
			'<div data-disc-area></div>';
		root.appendChild(card);
		card.querySelector('select[data-field="api"]').value = cfg.api || '';
		renderModelRows(card.querySelector('[data-models-area]'), name, cfg.models || []);
		renderDiscoveryFor(card.querySelector('[data-disc-area]'), name);
	}

	// Wire field inputs
	root.querySelectorAll('input[data-field], select[data-field]').forEach((el) => {
		el.addEventListener('input', () => {
			const card = el.closest('.provider-card');
			const provName = card?.dataset.prov;
			const field = el.getAttribute('data-field');
			if (!provName || !field) return;
			const cfg = modelsDraft.providers[provName];
			if (!cfg) return;
			if (field === '__name') {
				// Apply rename on blur (deferred); keep editing in place for now
				return;
			}
			cfg[field] = el.value;
			card.classList.toggle('dirty', provDirty(provName));
			updateSaveBar();
		});
	});
	// Rename on blur to preserve focus while typing
	root.querySelectorAll('input[data-field="__name"]').forEach((el) => {
		el.addEventListener('blur', () => {
			const card = el.closest('.provider-card');
			const oldName = card?.dataset.prov;
			const newName = el.value.trim();
			if (!oldName || !newName || oldName === newName) return;
			if (modelsDraft.providers[newName]) {
				showToast('이미 존재하는 공급자 ID 입니다.', true);
				el.value = oldName;
				return;
			}
			modelsDraft.providers[newName] = modelsDraft.providers[oldName];
			delete modelsDraft.providers[oldName];
			if (discoveryState[oldName]) {
				discoveryState[newName] = discoveryState[oldName];
				delete discoveryState[oldName];
			}
			renderProviders();
			updateSaveBar();
		});
	});
	root.querySelectorAll('button[data-del-prov]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			delete modelsDraft.providers[n];
			delete discoveryState[n];
			renderProviders();
			updateSaveBar();
		});
	});
	root.querySelectorAll('button[data-add-model]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			const cfg = modelsDraft.providers[n];
			if (!cfg) return;
			if (!cfg.models) cfg.models = [];
			cfg.models.push({ id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false });
			renderProviders();
			updateSaveBar();
		});
	});
	root.querySelectorAll('button[data-discover]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const card = btn.closest('.provider-card');
			const n = card?.dataset.prov;
			if (!n) return;
			const cfg = modelsDraft.providers[n];
			if (!cfg?.baseUrl) {
				showToast('baseUrl 을 먼저 입력하세요.', true);
				return;
			}
			discoveryState[n] = { ids: [], filter: '', selected: new Set(), loading: true, error: '', requestId: 'r' + Date.now() };
			renderProviders();
			post({
				kind: 'discover-models',
				baseUrl: cfg.baseUrl,
				apiKey: cfg.apiKey || '',
				requestId: discoveryState[n].requestId,
				providerName: n,  // echo back so we can route the response
			});
		});
	});
}

function renderModelRows(container, provName, models) {
	container.innerHTML = '';
	if (models.length === 0) {
		container.innerHTML = '<div style="font-size: 11px; color: var(--vscode-descriptionForeground); padding: 6px 0;">등록된 모델 없음 — "모델 발견" 또는 "수동 추가" 로 등록</div>';
		return;
	}
	// Header
	const header = document.createElement('div');
	header.className = 'model-grid';
	header.innerHTML = '<div class="label">#</div><div class="label">ID</div><div class="label">이름</div><div></div>';
	container.appendChild(header);
	models.forEach((m, idx) => {
		const row = document.createElement('div');
		row.className = 'model-row-card';
		row.innerHTML =
			'<div class="row-num">' + (idx + 1) + '</div>' +
			'<input type="text" placeholder="model-id" value="' + esc(m.id || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="id" />' +
			'<input type="text" placeholder="(optional)" value="' + esc(m.name || '') + '" data-mp="' + esc(provName) + '" data-mi="' + idx + '" data-mf="name" />' +
			'<button class="danger" data-del-model="' + esc(provName) + '" data-mi="' + idx + '" title="제거">✕</button>';
		container.appendChild(row);
	});
	container.querySelectorAll('input[data-mf]').forEach((el) => {
		el.addEventListener('input', () => {
			const p = el.getAttribute('data-mp');
			const i = parseInt(el.getAttribute('data-mi'), 10);
			const f = el.getAttribute('data-mf');
			if (!p || isNaN(i) || !f) return;
			const cfg = modelsDraft.providers[p];
			if (!cfg?.models?.[i]) return;
			cfg.models[i][f] = el.value;
			updateSaveBar();
			const card = el.closest('.provider-card');
			if (card) card.classList.toggle('dirty', provDirty(p));
		});
	});
	container.querySelectorAll('button[data-del-model]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const p = btn.getAttribute('data-del-model');
			const i = parseInt(btn.getAttribute('data-mi'), 10);
			if (!p || isNaN(i)) return;
			const cfg = modelsDraft.providers[p];
			if (cfg?.models) {
				cfg.models.splice(i, 1);
				renderProviders();
				updateSaveBar();
			}
		});
	});
}

function renderDiscoveryFor(container, provName) {
	const st = discoveryState[provName];
	container.innerHTML = '';
	if (!st) return;
	if (st.loading) {
		container.innerHTML = '<div class="disc-picker"><div class="disc-empty">모델 발견 중…</div></div>';
		return;
	}
	if (st.error) {
		container.innerHTML =
			'<div class="disc-picker"><div class="disc-empty" style="color: var(--vscode-errorForeground)">발견 실패: ' + esc(st.error) + '</div>' +
			'<div class="disc-footer"><button class="ghost" data-disc-close>닫기</button></div></div>';
		container.querySelector('button[data-disc-close]').addEventListener('click', () => {
			delete discoveryState[provName];
			renderProviders();
		});
		return;
	}
	const filtered = st.ids.filter((id) => !st.filter || id.toLowerCase().includes(st.filter.toLowerCase()));
	const cfg = modelsDraft.providers[provName];
	const existing = new Set(((cfg && cfg.models) || []).map((m) => m.id));

	const picker = document.createElement('div');
	picker.className = 'disc-picker';
	picker.innerHTML =
		'<div class="disc-header">' +
			'<div class="disc-title">' + st.ids.length + '개 모델 발견</div>' +
			'<div class="disc-actions">' +
				'<button data-disc-all>모두 선택</button>' +
				'<button data-disc-none>모두 선택 해제</button>' +
			'</div>' +
		'</div>' +
		'<input type="text" class="disc-search" placeholder="모델 검색…" value="' + esc(st.filter) + '" />' +
		'<div class="disc-list"></div>' +
		'<div class="disc-footer">' +
			'<button data-disc-add>' + st.selected.size + '개 모델 추가</button>' +
			'<button class="ghost" data-disc-close>취소</button>' +
		'</div>';
	container.appendChild(picker);
	const list = picker.querySelector('.disc-list');
	if (filtered.length === 0) {
		list.innerHTML = '<div class="disc-empty">검색 결과 없음</div>';
	} else {
		for (const id of filtered) {
			const item = document.createElement('label');
			item.className = 'disc-item';
			const isExisting = existing.has(id);
			item.innerHTML =
				'<input type="checkbox" ' + (st.selected.has(id) ? 'checked' : '') + (isExisting ? ' disabled' : '') + ' data-disc-id="' + esc(id) + '" />' +
				'<span>' + esc(id) + (isExisting ? ' <small style="color: var(--vscode-descriptionForeground)">(이미 등록됨)</small>' : '') + '</span>';
			list.appendChild(item);
		}
		list.querySelectorAll('input[data-disc-id]').forEach((cb) => {
			cb.addEventListener('change', () => {
				const id = cb.getAttribute('data-disc-id');
				if (cb.checked) st.selected.add(id);
				else st.selected.delete(id);
				picker.querySelector('button[data-disc-add]').textContent = st.selected.size + '개 모델 추가';
			});
		});
	}
	picker.querySelector('.disc-search').addEventListener('input', (ev) => {
		st.filter = ev.target.value;
		renderProviders();
		// Re-focus the search input after re-render
		setTimeout(() => {
			const newCard = document.querySelector('.provider-card[data-prov="' + CSS.escape(provName) + '"] .disc-search');
			if (newCard) {
				newCard.focus();
				newCard.setSelectionRange(st.filter.length, st.filter.length);
			}
		}, 0);
	});
	picker.querySelector('button[data-disc-all]').addEventListener('click', () => {
		for (const id of filtered) if (!existing.has(id)) st.selected.add(id);
		renderProviders();
	});
	picker.querySelector('button[data-disc-none]').addEventListener('click', () => {
		st.selected.clear();
		renderProviders();
	});
	picker.querySelector('button[data-disc-close]').addEventListener('click', () => {
		delete discoveryState[provName];
		renderProviders();
	});
	picker.querySelector('button[data-disc-add]').addEventListener('click', () => {
		if (!cfg) return;
		if (!cfg.models) cfg.models = [];
		const existingIds = new Set(cfg.models.map((m) => m.id));
		for (const id of st.selected) {
			if (!existingIds.has(id)) cfg.models.push({ id, name: '', contextWindow: '', maxTokens: '', reasoning: false });
		}
		showToast(st.selected.size + '개 모델 추가됨 (draft)');
		delete discoveryState[provName];
		renderProviders();
		updateSaveBar();
	});
}

function render(s) {
	diskState = s;
	modesDraft = {};
	for (const n of MODE_NAMES) modesDraft[n] = diskMode(n);
	authAddsDraft = {};
	authRemovesDraft = new Set();
	modelsDraft = JSON.parse(JSON.stringify(diskModels()));

	renderModes();
	renderAuth();
	renderProviders();
	updateSaveBar();
}

// Codex OAuth inline
const codexBtn = document.getElementById('codex-login-btn');
const codexCancel = document.getElementById('codex-cancel-btn');
const codexStatus = document.getElementById('codex-status');
codexBtn.addEventListener('click', () => {
	codexBtn.disabled = true;
	codexCancel.classList.remove('hidden');
	codexStatus.textContent = '시작 중…';
	post({ kind: 'codex-login' });
});
codexCancel.addEventListener('click', () => {
	post({ kind: 'codex-login-cancel' });
});

// Add auth (API key)
document.getElementById('add-auth-btn').addEventListener('click', () => {
	const id = document.getElementById('new-auth-id').value.trim();
	const key = document.getElementById('new-auth-key').value;
	if (!id || !key) { showToast('Provider id 와 API key 모두 입력해주세요.', true); return; }
	authAddsDraft[id] = key;
	document.getElementById('new-auth-id').value = '';
	document.getElementById('new-auth-key').value = '';
	renderAuth();
	updateSaveBar();
});

// Add custom provider — generate a unique placeholder name so the user can
// edit it inline (webview can't use window.prompt — it's blocked).
document.getElementById('add-provider-btn').addEventListener('click', () => {
	let base = 'new-provider';
	let name = base;
	let n = 1;
	while (modelsDraft.providers[name]) {
		n++;
		name = base + '-' + n;
	}
	modelsDraft.providers[name] = { baseUrl: '', api: 'openai-completions', apiKey: '', models: [] };
	renderProviders();
	updateSaveBar();
	// Focus the new card's name input
	setTimeout(() => {
		const newCard = document.querySelector('.provider-card[data-prov="' + CSS.escape(name) + '"]');
		if (newCard) {
			newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
			const nameInput = newCard.querySelector('input[data-field="__name"]');
			if (nameInput) {
				nameInput.focus();
				nameInput.select();
			}
		}
	}, 50);
});

// Cancel
document.getElementById('cancel-btn').addEventListener('click', () => {
	if (!diskState) return;
	render(diskState);
	showToast('변경사항 취소됨');
});

// Save
document.getElementById('save-btn').addEventListener('click', () => {
	const payload = {
		kind: 'save',
		modes: true,
		modeConfigs: modesDraft,
		authAdds: authAddsDraft,
		authRemoves: Array.from(authRemovesDraft),
		models: modelsDraft,
	};
	post(payload);
	showToast('저장 + 재로드 중…');
});

window.addEventListener('message', (ev) => {
	const msg = ev.data;
	if (!msg) return;
	if (msg.kind === 'state') render(msg.state);
	else if (msg.kind === 'error') showToast(msg.message || 'Error', true);
	else if (msg.kind === 'saved') showToast('저장됨: ' + (msg.files || []).join(', '));
	else if (msg.kind === 'codex-status') {
		const s = msg.state;
		if (s === 'success') {
			codexBtn.disabled = false;
			codexCancel.classList.add('hidden');
			codexStatus.textContent = '✓ ' + (msg.message || '완료');
			codexStatus.style.color = 'var(--vscode-charts-green, var(--vscode-foreground))';
			setTimeout(() => { codexStatus.textContent = ''; codexStatus.style.color = ''; }, 4000);
		} else if (s === 'error') {
			codexBtn.disabled = false;
			codexCancel.classList.add('hidden');
			codexStatus.textContent = '✗ ' + (msg.message || 'Error');
			codexStatus.style.color = 'var(--vscode-errorForeground)';
		} else {
			codexStatus.style.color = '';
			codexStatus.textContent = msg.message || '';
		}
	}
	else if (msg.kind === 'discovered-models') {
		// Match by requestId so a stale response doesn't overwrite a newer one
		for (const [provName, st] of Object.entries(discoveryState)) {
			if (st.requestId !== msg.requestId) continue;
			st.loading = false;
			if (msg.error) { st.error = msg.error; }
			else { st.ids = msg.ids || []; st.selected = new Set(); }
			renderProviders();
			break;
		}
	}
});

post({ kind: 'refresh' });
`;

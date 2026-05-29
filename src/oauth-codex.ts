// OpenAI Codex OAuth flow (ChatGPT Plus/Pro subscription).
//
// Reimplements the standard Authorization Code + PKCE flow that Pi uses
// (mirrors pi-coding-agent's utils/oauth/openai-codex.js — kept compatible so
// the auth.json tokens this writes are accepted by Pi's AuthStorage.refresh
// path). Standalone — no external deps beyond Node built-ins.
//
// Constants are intentionally identical to Pi's so the resulting credentials
// can be refreshed by either pi or this extension interchangeably.

import { randomBytes, createHash } from "node:crypto";
import * as http from "node:http";

const CALLBACK_HOST = process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1";
const CALLBACK_PORT = 1455;
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export interface CodexOAuthCallbacks {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onProgress?: (message: string) => void;
}

export interface CodexCredentials {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
}

function base64UrlEncode(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = base64UrlEncode(randomBytes(32));
	const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function createState(): string {
	return randomBytes(16).toString("hex");
}

function decodeJwt(token: string): any | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		// Standard base64 (not URL-safe) for JWT payload
		const padded = payload + "==".slice(0, (4 - (payload.length % 4)) % 4);
		const decoded = Buffer.from(padded, "base64").toString("utf-8");
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}

function getAccountId(accessToken: string): string | null {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const id = auth?.chatgpt_account_id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

function buildAuthorizeUrl(state: string, challenge: string): string {
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "hmm-code");
	return url.toString();
}

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Login complete</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:80px 20px;background:#0d1117;color:#c9d1d9}h1{color:#3fb950}p{color:#8b949e;font-size:14px}</style>
</head><body><h1>✓ 로그인 완료</h1><p>창을 닫아도 됩니다.</p></body></html>`;
const ERROR_HTML = (msg: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Login failed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:80px 20px;background:#0d1117;color:#c9d1d9}h1{color:#f85149}p{color:#8b949e;font-size:14px}</style>
</head><body><h1>✗ 로그인 실패</h1><p>${msg}</p></body></html>`;

interface CallbackResult { code: string }

function startCallbackServer(state: string, signal: AbortSignal): Promise<CallbackResult> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const server = http.createServer((req, res) => {
			res.setHeader("Connection", "close");
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			try {
				const url = new URL(req.url ?? "/", `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);
				if (url.pathname !== "/auth/callback") {
					// Stray probe (favicon, etc.) — respond but keep listening for
					// the real callback. (The old code tore the server down here.)
					res.statusCode = 404;
					res.end(ERROR_HTML("Callback 경로가 아닙니다."));
					return;
				}
				if (url.searchParams.get("state") !== state) {
					res.statusCode = 400;
					res.end(ERROR_HTML("state 불일치 (보안 검증 실패)."));
					settle(() => reject(new Error("OAuth state mismatch")));
					return;
				}
				const code = url.searchParams.get("code");
				if (!code) {
					res.statusCode = 400;
					res.end(ERROR_HTML("Authorization code 없음."));
					settle(() => reject(new Error("Missing authorization code")));
					return;
				}
				res.statusCode = 200;
				res.end(SUCCESS_HTML);
				settle(() => resolve({ code }));
			} catch (err) {
				res.statusCode = 500;
				res.end(ERROR_HTML("Internal error."));
				settle(() => reject(err instanceof Error ? err : new Error(String(err))));
			}
		});

		const closeServer = (): void => {
			// Drop keep-alive sockets (browsers hold the callback connection
			// open) so the listening port frees immediately — otherwise the next
			// login can hit EADDRINUSE.
			try { (server as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* ignore */ }
			try { server.close(); } catch { /* ignore */ }
		};
		const settle = (action: () => void): void => {
			if (settled) return;
			settled = true;
			// Let the browser render the response, then tear down.
			setTimeout(() => { closeServer(); action(); }, 200);
		};

		server.on("error", (err) => {
			const e = err as NodeJS.ErrnoException;
			const msg =
				e.code === "EADDRINUSE"
					? `포트 ${CALLBACK_PORT} 사용 중입니다. 다른 로그인(pi /login 등)을 닫고 다시 시도하세요.`
					: e.message;
			if (!settled) {
				settled = true;
				reject(new Error(msg));
			}
		});
		if (signal.aborted) {
			closeServer();
			settled = true;
			reject(new Error("Login cancelled"));
			return;
		}
		server.listen(CALLBACK_PORT, CALLBACK_HOST, () => { /* listening */ });
		signal.addEventListener("abort", () => {
			closeServer();
			if (!settled) {
				settled = true;
				reject(new Error("Login cancelled"));
			}
		});
	});
}

async function exchangeCodeForTokens(code: string, verifier: string) {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Token exchange ${res.status}: ${(text || res.statusText).slice(0, 200)}`);
	}
	const json: any = await res.json();
	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		// Report which fields are missing — never stringify `json`, which can
		// carry token material into an error message shown in the UI.
		const missing = [
			!json.access_token && "access_token",
			!json.refresh_token && "refresh_token",
			typeof json.expires_in !== "number" && "expires_in",
		]
			.filter(Boolean)
			.join(", ");
		throw new Error(`Token response missing/invalid fields: ${missing}`);
	}
	return {
		access: String(json.access_token),
		refresh: String(json.refresh_token),
		expires: Date.now() + json.expires_in * 1000,
	};
}

/**
 * Run the full Codex OAuth flow.
 *
 *   1. Start a local HTTP server on 127.0.0.1:1455 listening for the redirect.
 *   2. Open the OpenAI authorize URL in the user's browser (via
 *      vscode.env.openExternal — caller responsibility, we just emit it via
 *      onAuth callback).
 *   3. User completes login in browser, OpenAI redirects to localhost:1455.
 *   4. Server captures the code, exchanges it for tokens at the token endpoint.
 *   5. Returns credentials shaped exactly like Pi's AuthStorage expects so
 *      saving to auth.json yields a working OAuth entry.
 */
export async function codexOAuthLogin(
	callbacks: CodexOAuthCallbacks,
	signal: AbortSignal,
): Promise<CodexCredentials> {
	const { verifier, challenge } = generatePKCE();
	const state = createState();
	const url = buildAuthorizeUrl(state, challenge);

	callbacks.onAuth({
		url,
		instructions: "브라우저에서 OpenAI 로그인을 완료하세요. 로그인 완료 시 자동으로 토큰이 저장됩니다.",
	});

	callbacks.onProgress?.("Callback 서버 대기 중 (127.0.0.1:1455)…");
	const { code } = await startCallbackServer(state, signal);

	callbacks.onProgress?.("Token 교환 중…");
	const tokens = await exchangeCodeForTokens(code, verifier);

	const accountId = getAccountId(tokens.access);
	if (!accountId) {
		throw new Error("accessToken 에서 chatgpt_account_id 추출 실패");
	}

	return {
		type: "oauth",
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
		accountId,
	};
}

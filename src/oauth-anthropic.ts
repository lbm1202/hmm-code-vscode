// Anthropic OAuth flow (Claude Pro/Max subscription).
//
// Mirrors pi-ai's utils/oauth/anthropic.js (kept compatible so the auth.json
// "anthropic" entry this writes is accepted + refreshed by Pi's AuthStorage,
// which stores { type: "oauth", access, refresh, expires } and refreshes via
// getOAuthProvider("anthropic")). Standalone — Node built-ins only.
//
// Constants are intentionally identical to Pi's so the credentials are
// interchangeable with `pi`.

import { randomBytes, createHash } from "node:crypto";
import * as http from "node:http";

const CALLBACK_HOST = process.env.PI_OAUTH_CALLBACK_HOST || "127.0.0.1";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
// base64("9d1c250a-e61b-44d9-88ed-5944d1962f5e") — same client as pi-ai.
const CLIENT_ID = Buffer.from("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl", "base64").toString("utf-8");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export interface AnthropicOAuthCallbacks {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onProgress?: (message: string) => void;
}

export interface AnthropicCredentials {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
}

function base64UrlEncode(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = base64UrlEncode(randomBytes(32));
	const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function buildAuthorizeUrl(state: string, challenge: string): string {
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("code", "true");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPES);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	// pi-ai uses the PKCE verifier as the state value.
	url.searchParams.set("state", state);
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
				if (url.pathname !== CALLBACK_PATH) {
					res.statusCode = 404;
					res.end(ERROR_HTML("Callback 경로가 아닙니다."));
					return;
				}
				const err = url.searchParams.get("error");
				if (err) {
					res.statusCode = 400;
					res.end(ERROR_HTML(`인증이 완료되지 않았습니다: ${err}`));
					settle(() => reject(new Error(`Anthropic auth error: ${err}`)));
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
			} catch (e) {
				res.statusCode = 500;
				res.end(ERROR_HTML("Internal error."));
				settle(() => reject(e instanceof Error ? e : new Error(String(e))));
			}
		});

		const closeServer = (): void => {
			try { (server as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* ignore */ }
			try { server.close(); } catch { /* ignore */ }
		};
		const settle = (action: () => void): void => {
			if (settled) return;
			settled = true;
			setTimeout(() => { closeServer(); action(); }, 200);
		};

		server.on("error", (e) => {
			const err = e as NodeJS.ErrnoException;
			const msg =
				err.code === "EADDRINUSE"
					? `포트 ${CALLBACK_PORT} 사용 중입니다. 다른 로그인(pi /login 등)을 닫고 다시 시도하세요.`
					: err.message;
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

async function exchangeCodeForTokens(code: string, state: string, verifier: string) {
	// Anthropic's token endpoint expects JSON (not form-encoded).
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Token exchange ${res.status}: ${(text || res.statusText).slice(0, 200)}`);
	}
	const json: any = await res.json();
	if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		const missing = [
			!json.access_token && "access_token",
			!json.refresh_token && "refresh_token",
			typeof json.expires_in !== "number" && "expires_in",
		]
			.filter(Boolean)
			.join(", ");
		throw new Error(`Token response missing/invalid fields: ${missing}`);
	}
	// Match pi-ai: subtract a 5-minute safety margin from the expiry.
	return {
		access: String(json.access_token),
		refresh: String(json.refresh_token),
		expires: Date.now() + json.expires_in * 1000 - 5 * 60 * 1000,
	};
}

/**
 * Run the full Anthropic (Claude Pro/Max) OAuth flow. Same shape as
 * codexOAuthLogin so the settings panel can drive both identically.
 *
 *   1. Local HTTP server on 127.0.0.1:53692 for the redirect.
 *   2. Caller opens the authorize URL in the browser (via onAuth).
 *   3. User logs in; claude.ai redirects to localhost:53692/callback.
 *   4. Exchange the code for tokens (JSON POST).
 *   5. Return { type:"oauth", access, refresh, expires } for auth.json["anthropic"].
 */
export async function anthropicOAuthLogin(
	callbacks: AnthropicOAuthCallbacks,
	signal: AbortSignal,
): Promise<AnthropicCredentials> {
	const { verifier, challenge } = generatePKCE();
	const state = verifier;
	const url = buildAuthorizeUrl(state, challenge);

	callbacks.onAuth({
		url,
		instructions: "브라우저에서 Claude(Anthropic) 로그인을 완료하세요. 완료 시 자동으로 토큰이 저장됩니다.",
	});

	callbacks.onProgress?.("Callback 서버 대기 중 (127.0.0.1:53692)…");
	const { code } = await startCallbackServer(state, signal);

	callbacks.onProgress?.("Token 교환 중…");
	const tokens = await exchangeCodeForTokens(code, state, verifier);

	return { type: "oauth", access: tokens.access, refresh: tokens.refresh, expires: tokens.expires };
}

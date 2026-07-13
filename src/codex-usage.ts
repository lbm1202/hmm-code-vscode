// Read-only Codex (ChatGPT subscription) usage lookup.
//
// The official Codex CLI's `/status` is TUI-only, but the same data is served
// by an undocumented endpoint that third-party tools (codex-check, codex-limit)
// rely on. We hit it directly with the OAuth token we already stored at
// ~/.pi/agent/auth.json[openai-codex] — no extra tool, API key, or browser
// cookie needed. Best-effort: any failure (expired token, endpoint change,
// offline) surfaces as a thrown Error the panel shows inline.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export interface CodexWindow {
	usedPercent: number;
	/** Unix epoch seconds when this window resets. */
	resetAt: number;
	/** Window length in seconds (18000 = 5h, 604800 = weekly). */
	windowSeconds: number;
}

export interface CodexUsage {
	planType: string;
	limitReached: boolean;
	primary?: CodexWindow;
	secondary?: CodexWindow;
}

function parseWindow(w: any): CodexWindow | undefined {
	if (!w || typeof w !== "object") return undefined;
	return {
		usedPercent: Number(w.used_percent ?? 0),
		resetAt: Number(w.reset_at ?? 0),
		windowSeconds: Number(w.limit_window_seconds ?? 0),
	};
}

export async function fetchCodexUsage(): Promise<CodexUsage> {
	if (!existsSync(AUTH_PATH)) throw new Error("auth.json not found");
	const cred = JSON.parse(readFileSync(AUTH_PATH, "utf-8"))?.["openai-codex"];
	if (!cred || cred.type !== "oauth" || !cred.access) {
		throw new Error("Codex is not authenticated");
	}
	const res = await fetch(USAGE_URL, {
		headers: {
			Authorization: `Bearer ${cred.access}`,
			Accept: "application/json",
			"ChatGPT-Account-Id": String(cred.accountId ?? ""),
			Origin: "https://chatgpt.com",
			Referer: "https://chatgpt.com/",
			"User-Agent": "Mozilla/5.0",
		},
	});
	if (!res.ok) {
		// 401 typically means the stored access token expired — running a chat
		// turn refreshes it (Pi writes the new token back to auth.json).
		const hint = res.status === 401 ? " (token expired — run a chat turn or re-login)" : "";
		throw new Error(`HTTP ${res.status} ${res.statusText}${hint}`);
	}
	const j: any = await res.json();
	const rl = j?.rate_limit ?? {};
	return {
		planType: String(j?.plan_type ?? "?"),
		limitReached: !!rl.limit_reached,
		primary: parseWindow(rl.primary_window),
		secondary: parseWindow(rl.secondary_window),
	};
}

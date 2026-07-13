// Pre-flight OAuth freshness for subscription-usage lookups. An expired access
// token 401s the usage endpoints ("token expired — run a chat turn or
// re-login"), but Pi can refresh it without an LLM turn: resolving a
// provider's API key through AuthStorage refreshes + persists an expired
// OAuth token under a file lock. The host must NOT refresh tokens itself —
// Pi caches AuthStorage in memory and refresh tokens rotate, so a host-side
// write would race Pi's copy. Instead we dispatch the internal /auth-refresh
// command to a running Pi and wait for auth.json to show a future expiry.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

/** Providers whose subscription usage the UI can look up. */
export const OAUTH_USAGE_PROVIDERS = ["anthropic", "openai-codex"] as const;

function readCred(provider: string): any {
	if (!existsSync(AUTH_PATH)) return undefined;
	try {
		return JSON.parse(readFileSync(AUTH_PATH, "utf-8"))?.[provider];
	} catch {
		return undefined;
	}
}

/** Same condition AuthStorage.getApiKey refreshes on — asking Pi any earlier
 *  is a no-op, so don't bother with an expiry margin. */
function isExpiredOAuth(cred: any): boolean {
	return cred?.type === "oauth" && typeof cred.expires === "number" && Date.now() >= cred.expires;
}

/** If `provider`'s OAuth token is expired, ask a running Pi to refresh it
 *  (via `sendSlash`, which returns false when no Pi is live) and wait for the
 *  refreshed credential to land in auth.json. Resolves either way — on
 *  timeout the usage fetch just surfaces its 401 hint as before. */
export async function ensureFreshOAuth(
	provider: string,
	sendSlash: (text: string) => boolean,
): Promise<void> {
	if (!isExpiredOAuth(readCred(provider))) return;
	if (!sendSlash(`/auth-refresh ${provider}`)) return; // no live Pi — nothing to wait for
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 250));
		if (!isExpiredOAuth(readCred(provider))) return;
	}
}

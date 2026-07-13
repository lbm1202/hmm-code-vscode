// Shared auth.json credential writer for the browser OAuth flows (settings
// panel + onboarding card). Writes the shape Pi's AuthStorage expects; the
// caller is responsible for restarting Pi afterwards (it caches AuthStorage
// in memory, so a file edit alone is invisible).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

export function writeOAuthCredential(providerId: string, creds: unknown): void {
	let raw: any = {};
	if (existsSync(AUTH_PATH)) {
		try {
			raw = JSON.parse(readFileSync(AUTH_PATH, "utf-8")) ?? {};
		} catch {
			raw = {};
		}
	}
	raw[providerId] = creds;
	mkdirSync(dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
	writeFileSync(AUTH_PATH, JSON.stringify(raw, null, 2), "utf-8");
	try {
		chmodSync(AUTH_PATH, 0o600);
	} catch {
		/* non-POSIX */
	}
}

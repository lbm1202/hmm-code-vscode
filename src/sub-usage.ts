// Aggregate subscription plan usage for the chat topbar popover: which OAuth
// subscriptions exist in auth.json (Claude Pro/Max, ChatGPT Codex) and what
// each provider's usage endpoint reports for them. Per-provider best-effort —
// one failing endpoint yields an error entry, not a failed aggregate.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchAnthropicUsage, type AnthropicUsage } from "./anthropic-usage";
import { fetchCodexUsage, type CodexUsage } from "./codex-usage";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

export interface SubUsageEntry {
	provider: "anthropic" | "openai-codex";
	usage?: AnthropicUsage;
	codex?: CodexUsage;
	error?: string;
}

function oauthProviders(): Set<string> {
	if (!existsSync(AUTH_PATH)) return new Set();
	try {
		const raw = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
		return new Set(
			Object.entries(raw ?? {})
				.filter(([, cred]: [string, any]) => cred?.type === "oauth")
				.map(([id]) => id),
		);
	} catch {
		return new Set();
	}
}

/** Fetch usage for every connected subscription. Returns one entry per
 *  connected provider (empty array = nothing connected). */
export async function collectSubscriptionUsage(): Promise<SubUsageEntry[]> {
	const connected = oauthProviders();
	const jobs: Promise<SubUsageEntry>[] = [];
	if (connected.has("anthropic")) {
		jobs.push(
			fetchAnthropicUsage()
				.then((usage): SubUsageEntry => ({ provider: "anthropic", usage }))
				.catch((err): SubUsageEntry => ({ provider: "anthropic", error: (err as Error).message })),
		);
	}
	if (connected.has("openai-codex")) {
		jobs.push(
			fetchCodexUsage()
				.then((codex): SubUsageEntry => ({ provider: "openai-codex", codex }))
				.catch((err): SubUsageEntry => ({ provider: "openai-codex", error: (err as Error).message })),
		);
	}
	return Promise.all(jobs);
}

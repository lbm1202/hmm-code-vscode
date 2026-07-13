// Read-only Claude (Anthropic subscription) usage lookup.
//
// The subscription dashboard reads plan usage from this endpoint; we hit it directly
// with the OAuth token already stored at ~/.pi/agent/auth.json[anthropic] — no
// extra tool, API key, or browser cookie needed. Best-effort: any failure
// (expired token, endpoint change, offline) surfaces as a thrown Error the
// panel shows inline. Verified response shape (fields used below):
//   { limits: [{ kind:"session"|"weekly_all"|"weekly_scoped", group, percent,
//                severity, resets_at, scope, is_active }],
//     five_hour: { utilization, resets_at }, seven_day: { utilization, resets_at },
//     extra_usage: { is_enabled, monthly_limit, used_credits, utilization,
//                    currency, decimal_places } }

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface AnthropicWindow {
	/** "session" (5h) or "weekly". */
	kind: string;
	/** 0–100. */
	usedPercent: number;
	/** Unix epoch seconds when this window resets (0 if unknown). */
	resetAt: number;
}

export interface AnthropicExtra {
	enabled: boolean;
	usedPercent: number;
	/** Monthly extra-usage cap in whole currency units (e.g. dollars). */
	limitAmount: number;
	currency: string;
}

export interface AnthropicUsage {
	windows: AnthropicWindow[];
	extra?: AnthropicExtra;
}

function toEpoch(iso: unknown): number {
	const t = Date.parse(String(iso ?? ""));
	return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

export async function fetchAnthropicUsage(): Promise<AnthropicUsage> {
	if (!existsSync(AUTH_PATH)) throw new Error("auth.json not found");
	const cred = JSON.parse(readFileSync(AUTH_PATH, "utf-8"))?.["anthropic"];
	if (!cred || cred.type !== "oauth" || !cred.access) {
		throw new Error("Claude is not authenticated");
	}
	const res = await fetch(USAGE_URL, {
		headers: {
			Authorization: `Bearer ${cred.access}`,
			"anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
			"anthropic-version": "2023-06-01",
			"User-Agent": "claude-cli/2.1.205 (external, cli)",
			"x-app": "cli",
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		// 401 typically means the stored access token expired — running a chat turn
		// refreshes it (Pi writes the new token back to auth.json).
		const hint = res.status === 401 ? " (token expired — run a chat turn or re-login)" : "";
		throw new Error(`Usage lookup failed: HTTP ${res.status}${hint}`);
	}
	const data: any = await res.json();

	// Prefer the normalized limits[] array; fall back to the five_hour/seven_day
	// blocks if it's absent.
	const windows: AnthropicWindow[] = [];
	const limits: any[] = Array.isArray(data?.limits) ? data.limits : [];
	const session = limits.find((l) => l?.kind === "session" || l?.group === "session");
	const weekly = limits.find(
		(l) => l?.kind === "weekly_all" || (l?.group === "weekly" && !l?.scope),
	);
	if (session) windows.push({ kind: "session", usedPercent: num(session.percent), resetAt: toEpoch(session.resets_at) });
	else if (data?.five_hour) windows.push({ kind: "session", usedPercent: num(data.five_hour.utilization), resetAt: toEpoch(data.five_hour.resets_at) });
	if (weekly) windows.push({ kind: "weekly", usedPercent: num(weekly.percent), resetAt: toEpoch(weekly.resets_at) });
	else if (data?.seven_day) windows.push({ kind: "weekly", usedPercent: num(data.seven_day.utilization), resetAt: toEpoch(data.seven_day.resets_at) });

	const eu = data?.extra_usage;
	let extra: AnthropicExtra | undefined;
	if (eu && typeof eu === "object") {
		const places = num(eu.decimal_places) || 2;
		extra = {
			enabled: eu.is_enabled === true,
			usedPercent: num(eu.utilization),
			limitAmount: num(eu.monthly_limit) / Math.pow(10, places),
			currency: String(eu.currency ?? "USD"),
		};
	}

	return { windows, extra };
}

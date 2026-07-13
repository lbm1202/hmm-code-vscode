// First-run onboarding: conservative "no auth anywhere" detection and the
// per-mode model presets applied after a successful subscription login.
//
// Detection errs toward NOT showing the card — auth can live in places we
// can't fully see (env vars for exotic providers, keys embedded in custom
// provider configs, proxies that need none), and the card must never gate a
// working setup. A false positive costs nothing anyway: the card is advisory
// and chat input stays live.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PI_DIR = join(homedir(), ".pi", "agent");
const AUTH_PATH = join(PI_DIR, "auth.json");
const MODES_PATH = join(PI_DIR, "modes.json");
const MODELS_PATH = join(PI_DIR, "models.json");

/** Env vars Pi resolves API keys from for the common built-in providers. */
const API_KEY_ENV_VARS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
	"XAI_API_KEY",
	"GROQ_API_KEY",
	"DEEPSEEK_API_KEY",
	"OPENROUTER_API_KEY",
	"MISTRAL_API_KEY",
	"TOGETHER_API_KEY",
	"FIREWORKS_API_KEY",
	"CEREBRAS_API_KEY",
];

function readJsonSafe(path: string): any {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/** True only when NO auth source is visible: empty/absent auth.json, none of
 *  the common API-key env vars, and no custom providers in models.json. */
export function noAuthDetected(): boolean {
	const auth = readJsonSafe(AUTH_PATH);
	if (auth && Object.keys(auth).length > 0) return false;
	if (API_KEY_ENV_VARS.some((v) => (process.env[v] ?? "").trim() !== "")) return false;
	const models = readJsonSafe(MODELS_PATH);
	if (models?.providers && Object.keys(models.providers).length > 0) return false;
	return true;
}

/** Recommended per-mode models per subscription provider: reasoning-heavy
 *  planning/verification on the flagship, implementation/queries on the
 *  faster (and subscription-cheaper) tier. */
const MODE_PRESETS: Record<string, { planReview: string; rest: string }> = {
	anthropic: { planReview: "claude-opus-4-8", rest: "claude-sonnet-5" },
	"openai-codex": { planReview: "gpt-5.6", rest: "gpt-5.5" },
};

export interface PresetApplied {
	/** e.g. { "plan · review": "claude-opus-4-8", "code · debug · ask": "claude-sonnet-5" } */
	groups: { modes: string[]; model: string }[];
}

/** After a successful login for `provider`, fill the preset model into every
 *  mode whose model is EMPTY — configured modes are never overwritten, and a
 *  preset id is only written when the live catalog actually has it. Returns
 *  what was applied (for the onboarding card), or null when nothing changed. */
export function applyModePresets(
	provider: string,
	availableModels: { provider: string; id: string }[],
): PresetApplied | null {
	const preset = MODE_PRESETS[provider];
	if (!preset) return null;
	const modesFile = readJsonSafe(MODES_PATH);
	const modes = modesFile?.modes;
	if (!modes || typeof modes !== "object") return null; // Pi hasn't written its example config yet

	const inCatalog = (id: string): boolean =>
		availableModels.some((m) => m.provider === provider && m.id === id);

	const byModel = new Map<string, string[]>();
	for (const [name, cfg] of Object.entries<any>(modes)) {
		if (!cfg || typeof cfg !== "object") continue;
		if (cfg.model) continue; // already configured — leave alone
		const id = name === "plan" || name === "review" ? preset.planReview : preset.rest;
		if (!inCatalog(id)) continue;
		cfg.model = { provider, id };
		byModel.set(id, [...(byModel.get(id) ?? []), name]);
	}
	if (byModel.size === 0) return null;
	writeFileSync(MODES_PATH, JSON.stringify(modesFile, null, 2), "utf-8");
	return { groups: [...byModel.entries()].map(([model, ms]) => ({ modes: ms, model })) };
}

// Host-side i18n. Loads locale dictionaries from l10n/<locale>.json and
// exposes t() for extension-host strings plus getWebviewMessages() for the
// merged dict injected into webviews.
//
// English (en.json) is the source/default. Other locales overlay it, so any
// missing key falls back to the English string. Locale resolution: the
// hmm-code.language setting wins ("en"/"ko"); "auto" follows vscode.env.language.

import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Locale = "en" | "ko";
type Params = Record<string, string | number>;

let extRoot = "";
let cachedLocale: Locale | undefined;
let cachedMessages: Record<string, string> | undefined;

/** Call once at activation with ctx.extensionPath. */
export function initI18n(extensionPath: string): void {
	extRoot = extensionPath;
	clearI18nCache();
}

export function clearI18nCache(): void {
	cachedLocale = undefined;
	cachedMessages = undefined;
}

export function resolveLocale(): Locale {
	const setting = vscode.workspace.getConfiguration("hmm-code").get<string>("language", "auto");
	if (setting === "en" || setting === "ko") return setting;
	const lang = (vscode.env.language || "en").toLowerCase();
	return lang.startsWith("ko") ? "ko" : "en";
}

function loadRaw(locale: Locale): Record<string, string> {
	try {
		const parsed = JSON.parse(readFileSync(join(extRoot, "l10n", `${locale}.json`), "utf-8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Merged dict for the active locale (English base + locale overlay). Cached. */
export function getMessages(): Record<string, string> {
	const locale = resolveLocale();
	if (cachedMessages && cachedLocale === locale) return cachedMessages;
	const base = loadRaw("en");
	cachedMessages = locale === "en" ? base : { ...base, ...loadRaw(locale) };
	cachedLocale = locale;
	return cachedMessages;
}

/** The dict to inject into a webview as window.__HMM_I18N. */
export function getWebviewMessages(): Record<string, string> {
	return getMessages();
}

function format(tpl: string, params?: Params): string {
	if (!params) return tpl;
	return tpl.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? String(params[k]) : `{${k}}`));
}

/** Translate a key for host-side strings. Falls back to the key itself. */
export function t(key: string, params?: Params): string {
	return format(getMessages()[key] ?? key, params);
}

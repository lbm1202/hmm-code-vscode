// Per-line syntax highlighting for edit/write diff output.
//
// Shiki gives us VS Code's exact TextMate grammars + Dark+ theme tokens.
// We use the JS regex engine (not oniguruma WASM) to keep the bundle pure
// JS and the webview Content-Security-Policy simple. Tradeoff: ~5-15% slower
// tokenization, fine for sub-100-line diffs.
//
// Init is async (grammar/theme parse), but rendering is sync — so the first
// few diffs may render plain while the highlighter spins up. Once ready,
// `highlightLine` returns colored token spans instead of plain escaped HTML.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { escapeHtml } from "./helpers";

import darkPlus from "shiki/themes/dark-plus.mjs";

import langBash from "shiki/langs/bash.mjs";
import langC from "shiki/langs/c.mjs";
import langCpp from "shiki/langs/cpp.mjs";
import langCss from "shiki/langs/css.mjs";
import langDiff from "shiki/langs/diff.mjs";
import langGo from "shiki/langs/go.mjs";
import langHtml from "shiki/langs/html.mjs";
import langIni from "shiki/langs/ini.mjs";
import langJava from "shiki/langs/java.mjs";
import langJavascript from "shiki/langs/javascript.mjs";
import langJson from "shiki/langs/json.mjs";
import langJsonc from "shiki/langs/jsonc.mjs";
import langJsx from "shiki/langs/jsx.mjs";
import langMarkdown from "shiki/langs/markdown.mjs";
import langPython from "shiki/langs/python.mjs";
import langRust from "shiki/langs/rust.mjs";
import langScss from "shiki/langs/scss.mjs";
import langSql from "shiki/langs/sql.mjs";
import langSvelte from "shiki/langs/svelte.mjs";
import langToml from "shiki/langs/toml.mjs";
import langTsx from "shiki/langs/tsx.mjs";
import langTypescript from "shiki/langs/typescript.mjs";
import langVue from "shiki/langs/vue.mjs";
import langXml from "shiki/langs/xml.mjs";
import langYaml from "shiki/langs/yaml.mjs";

const THEME_NAME = "dark-plus";

let cached: HighlighterCore | undefined;
let initPromise: Promise<HighlighterCore> | undefined;

function init(): Promise<HighlighterCore> {
	if (initPromise) return initPromise;
	initPromise = createHighlighterCore({
		themes: [darkPlus],
		langs: [
			langBash, langC, langCpp, langCss, langDiff, langGo, langHtml, langIni,
			langJava, langJavascript, langJson, langJsonc, langJsx, langMarkdown,
			langPython, langRust, langScss, langSql, langSvelte, langToml, langTsx,
			langTypescript, langVue, langXml, langYaml,
		],
		engine: createJavaScriptRegexEngine(),
	}).then((h) => {
		cached = h;
		return h;
	});
	return initPromise;
}

// Kick off initialization at module load so by the time the user triggers
// a tool call (seconds later), the highlighter is usually ready.
init().catch((err) => {
	console.error("[syntax] highlighter init failed:", err);
});

/** Map a file path's extension to a Shiki language id, or undefined if we
 *  don't have a grammar for it (caller falls back to plain text). */
const EXT_TO_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	py: "python",
	pyi: "python",
	go: "go",
	rs: "rust",
	java: "java",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	css: "css",
	scss: "scss",
	html: "html",
	htm: "html",
	xml: "xml",
	svg: "xml",
	json: "json",
	jsonc: "jsonc",
	json5: "jsonc",
	md: "markdown",
	markdown: "markdown",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	ini: "ini",
	sql: "sql",
	vue: "vue",
	svelte: "svelte",
};

export function langFromPath(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const m = path.match(/\.([A-Za-z0-9]+)$/);
	if (!m) return undefined;
	const ext = m[1].toLowerCase();
	const lang = EXT_TO_LANG[ext];
	return lang || undefined;
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Highlight a single line. Returns HTML — token spans when Shiki is ready
 *  and the language is supported, else plain escaped text. Never throws. */
export function highlightLine(line: string, lang: string | undefined): string {
	if (!cached || !lang) return escapeHtml(line);
	try {
		const tokens = cached.codeToTokensBase(line, {
			lang: lang as any,
			theme: THEME_NAME,
		});
		const first = tokens[0];
		if (!first) return escapeHtml(line);
		return first
			.map((t) => {
				const style = t.color ? ` style="color:${escapeAttr(t.color)}"` : "";
				return `<span${style}>${escapeHtml(t.content)}</span>`;
			})
			.join("");
	} catch {
		return escapeHtml(line);
	}
}

/** Highlight a multi-line block as one tokenization pass so cross-line
 *  context (multi-line strings, block comments, here-docs) is preserved.
 *  Each token row is joined with "\n" so the result drops into a <pre>
 *  without further structural markup. */
export function highlightBlock(text: string, lang: string | undefined): string {
	if (!cached || !lang) return escapeHtml(text);
	try {
		const tokens = cached.codeToTokensBase(text, {
			lang: lang as any,
			theme: THEME_NAME,
		});
		return tokens
			.map((line) =>
				line
					.map((t) => {
						const style = t.color ? ` style="color:${escapeAttr(t.color)}"` : "";
						return `<span${style}>${escapeHtml(t.content)}</span>`;
					})
					.join(""),
			)
			.join("\n");
	} catch {
		return escapeHtml(text);
	}
}

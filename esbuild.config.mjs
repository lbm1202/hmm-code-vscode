import { build, context } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Public HTTPS — no auth required. Override via HMM_CODE_PI_REPO env var if
// you maintain a fork or a private mirror.
const HMM_CODE_PI_REPO =
	process.env.HMM_CODE_PI_REPO ?? "https://github.com/lbm1202/hmm-code-pi.git";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
// Minify in non-watch builds — webview pulls in Shiki (grammars + theme) and
// without minification the bundle blows past 2MB. Watch keeps it readable.
const minify = !watch;

const extensionConfig = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "out/extension.js",
	platform: "node",
	target: "node18",
	format: "cjs",
	external: ["vscode"],
	sourcemap: true,
	logLevel: "info",
};

const webviewConfig = {
	entryPoints: ["webview/main.ts"],
	bundle: true,
	outfile: "out/webview/main.js",
	platform: "browser",
	target: "es2022",
	format: "iife",
	sourcemap: true,
	minify,
	logLevel: "info",
};

const webviewCssConfig = {
	entryPoints: ["webview/styles.css"],
	bundle: false,
	outfile: "out/webview/styles.css",
	loader: { ".css": "copy" },
	logLevel: "info",
};

// Settings-panel webview script. Plain JS (extracted from settings-panel.ts),
// loaded via <script src> with a CSP nonce — same delivery as the chat main.js.
const settingsConfig = {
	entryPoints: ["webview/settings.ts"],
	bundle: true,
	outfile: "out/webview/settings.js",
	platform: "browser",
	target: "es2022",
	format: "iife",
	sourcemap: true,
	minify,
	logLevel: "info",
};

/** Resolve where to pick up hmm-code-pi source:
 *   1. $HMM_CODE_PI_PATH env var if set (escape hatch for custom layouts)
 *   2. ../hmm-code-pi sibling (the dev-friendly layout — edit + rebuild loop)
 *   3. node_modules/.cache/hmm-code-pi (auto-cloned once per machine)
 *  Last one runs git clone the first time, then reuses the cache. */
function resolveHmmCodePiSrc() {
	const envPath = process.env.HMM_CODE_PI_PATH;
	if (envPath && existsSync(envPath)) return envPath;

	const sibling = join(__dirname, "..", "hmm-code-pi");
	if (existsSync(sibling)) return sibling;

	const cacheDir = join(__dirname, "node_modules", ".cache", "hmm-code-pi");
	if (existsSync(cacheDir)) {
		console.log(`[vendor] reusing cached hmm-code-pi at ${cacheDir}`);
		console.log(`[vendor] (run \`rm -rf ${cacheDir} && npm run build\` to refresh)`);
		return cacheDir;
	}

	console.log(`[vendor] hmm-code-pi not found locally — cloning ${HMM_CODE_PI_REPO}`);
	try {
		execSync(`git clone --depth 1 ${HMM_CODE_PI_REPO} "${cacheDir}"`, { stdio: "inherit" });
	} catch (err) {
		throw new Error(
			`Failed to clone hmm-code-pi from ${HMM_CODE_PI_REPO}.\n\n` +
				`The repo is private — set up a GitHub SSH key or override the URL:\n` +
				`  HMM_CODE_PI_REPO="https://<PAT>@github.com/lbm1202/hmm-code-pi.git" npm run build\n` +
				`Or point at an existing clone:\n` +
				`  HMM_CODE_PI_PATH="/path/to/hmm-code-pi" npm run build\n`,
		);
	}
	return cacheDir;
}

/** Pull the string values out of a `STATUS_KEYS = { ... } as const` block. */
function extractStatusValues(file) {
	const text = readFileSync(file, "utf-8");
	const block = text.match(/STATUS_KEYS\s*=\s*\{([\s\S]*?)\}\s*as const/);
	if (!block) throw new Error(`[contract-check] STATUS_KEYS not found in ${file}`);
	const vals = new Set();
	for (const m of block[1].matchAll(/:\s*"([^"]+)"/g)) vals.add(m[1]);
	return vals;
}

/** Pull the members out of a `BINARY_THINKING_FORMATS = new Set([...])`. */
function extractBinarySet(file) {
	const text = readFileSync(file, "utf-8");
	const block = text.match(/BINARY_THINKING_FORMATS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
	if (!block) return null;
	const vals = new Set();
	for (const m of block[1].matchAll(/"([^"]+)"/g)) vals.add(m[1]);
	return vals;
}

/** Fail the build if the cross-repo contracts CLAUDE.md flags drift. Cheap
 *  (regex over 3 files) and runs on every `npm run build`, so the release
 *  workflow (which calls build) gates on it too. Pi's constants.ts is the
 *  source of truth; the two VS Code mirrors must contain every Pi STATUS key. */
function assertContractsInSync(hmmSrc) {
	const piConstants = join(hmmSrc, "constants.ts");
	if (!existsSync(piConstants)) {
		console.warn(`[contract-check] skipped — ${piConstants} not found`);
		return;
	}
	// STATUS_KEYS now has a single VS Code-side source — src/protocol-shared.ts;
	// both src/protocol.ts and webview/protocol.ts re-export it.
	const sharedProto = join(__dirname, "src", "protocol-shared.ts");
	const webProto = join(__dirname, "webview", "protocol.ts");
	const piKeys = extractStatusValues(piConstants);
	const mirror = extractStatusValues(sharedProto);
	const missing = [...piKeys].filter((v) => !mirror.has(v));
	if (missing.length) {
		throw new Error(
			`[contract-check] STATUS_KEYS drift: src/protocol-shared.ts is missing ` +
				`${JSON.stringify(missing)} (present in hmm-code-pi/constants.ts). ` +
				`Add them so the RPC status contract stays in sync.`,
		);
	}
	const piBin = extractBinarySet(piConstants);
	const webBin = extractBinarySet(webProto);
	if (piBin && webBin) {
		const a = [...piBin].sort().join(",");
		const b = [...webBin].sort().join(",");
		if (a !== b) {
			throw new Error(
				`[contract-check] BINARY_THINKING_FORMATS drift: pi={${a}} vs webview={${b}}.`,
			);
		}
	}
	// The settings panel parses DEFAULT_MODES[*].systemPromptAddendum out of
	// config.ts to show per-mode default prompts. Assert all four modes still
	// parse so a format change in Pi (single string, template literal, etc.)
	// fails the build instead of silently blanking the panel defaults.
	const piConfig = join(hmmSrc, "config.ts");
	if (existsSync(piConfig)) {
		const cfgSrc = readFileSync(piConfig, "utf-8");
		const missing = [];
		for (const mode of ["plan", "code", "debug", "ask"]) {
			const m = cfgSrc.match(
				new RegExp(`${mode}:\\s*\\{[\\s\\S]*?systemPromptAddendum:\\s*\\[([\\s\\S]*?)\\]\\.join\\(`),
			);
			let ok = false;
			if (m) {
				try {
					const arr = JSON.parse(`[${m[1].replace(/,\s*$/, "")}]`);
					ok = Array.isArray(arr) && arr.length > 0;
				} catch {
					ok = false;
				}
			}
			if (!ok) missing.push(mode);
		}
		if (missing.length) {
			throw new Error(
				`[contract-check] DEFAULT_MODES.systemPromptAddendum no longer parses for ${JSON.stringify(missing)}. ` +
					`The settings panel (src/settings-panel.ts:defaultPrompts) relies on the string-array \`.join("\\n")\` format. ` +
					`Keep it, or update the parser in both places.`,
			);
		}
	}
	console.log("[contract-check] STATUS_KEYS + BINARY_THINKING_FORMATS + mode prompts in sync ✓");
}

/** Copy Pi runtime + hmm-code-pi extension into out/vendor/ so the packaged
 *  .vsix is self-contained. esbuild can't bundle Pi (dynamic requires, native
 *  optional deps), so we ship raw files and spawn cli.js with Node. */
function vendorBundle() {
	const piSrc = join(__dirname, "node_modules", "@earendil-works", "pi-coding-agent");
	const piDst = join(__dirname, "out", "vendor", "pi");
	const hmmSrc = resolveHmmCodePiSrc();
	const hmmDst = join(__dirname, "out", "vendor", "hmm-code-pi");

	assertContractsInSync(hmmSrc);

	if (!existsSync(piSrc)) {
		throw new Error(`Pi not installed at ${piSrc}. Run \`npm install\` first.`);
	}

	// Wipe stale vendor copies so removed files don't linger.
	if (existsSync(piDst)) rmSync(piDst, { recursive: true, force: true });
	if (existsSync(hmmDst)) rmSync(hmmDst, { recursive: true, force: true });

	cpSync(piSrc, piDst, {
		recursive: true,
		// Strip junk — saves ~10MB in the final .vsix without affecting runtime.
		filter: (src) => !/(\.map$|\.d\.ts$|\/tests?\/|\/__tests__\/|\.test\.[jt]s$)/.test(src),
	});

	cpSync(hmmSrc, hmmDst, {
		recursive: true,
		filter: (src) => !/(\.git\/|node_modules\/|\.map$|\/tests?\/|\.test\.[jt]s$)/.test(src),
	});

	const piSize = (dirSize(piDst) / 1024 / 1024).toFixed(1);
	const hmmSize = (dirSize(hmmDst) / 1024 / 1024).toFixed(1);
	console.log(`[vendor] Pi → out/vendor/pi (${piSize}MB)`);
	console.log(`[vendor] hmm-code-pi → out/vendor/hmm-code-pi (${hmmSize}MB)`);
}

function dirSize(p) {
	let total = 0;
	const stack = [p];
	while (stack.length) {
		const cur = stack.pop();
		const st = statSync(cur);
		if (st.isDirectory()) {
			for (const name of readdirSync(cur)) stack.push(join(cur, name));
		} else {
			total += st.size;
		}
	}
	return total;
}

if (watch) {
	const ctxA = await context(extensionConfig);
	const ctxB = await context(webviewConfig);
	const ctxC = await context(webviewCssConfig);
	const ctxD = await context(settingsConfig);
	await Promise.all([ctxA.watch(), ctxB.watch(), ctxC.watch(), ctxD.watch()]);
	console.log("[esbuild] watching… (vendor copy only on initial build — re-run `npm run build` after Pi update)");
	vendorBundle();
} else {
	await Promise.all([
		build(extensionConfig),
		build(webviewConfig),
		build(webviewCssConfig),
		build(settingsConfig),
	]);
	vendorBundle();
}

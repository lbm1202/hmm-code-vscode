import { build, context } from "esbuild";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Copy Pi runtime + hmm-code-pi extension into out/vendor/ so the packaged
 *  .vsix is self-contained. esbuild can't bundle Pi (dynamic requires, native
 *  optional deps), so we ship raw files and spawn cli.js with Node. */
function vendorBundle() {
	const piSrc = join(__dirname, "node_modules", "@earendil-works", "pi-coding-agent");
	const piDst = join(__dirname, "out", "vendor", "pi");
	const hmmSrc = join(__dirname, "..", "hmm-code-pi");
	const hmmDst = join(__dirname, "out", "vendor", "hmm-code-pi");

	if (!existsSync(piSrc)) {
		throw new Error(`Pi not installed at ${piSrc}. Run \`npm install\` first.`);
	}
	if (!existsSync(hmmSrc)) {
		throw new Error(
			`hmm-code-pi not found at ${hmmSrc}. Expected sibling directory (clone https://github.com/lbm1202/hmm-code-pi next to hmm-code-vscode).`,
		);
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
		filter: (src) => !/(\.git\/|node_modules\/|\.map$)/.test(src),
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
	await Promise.all([ctxA.watch(), ctxB.watch(), ctxC.watch()]);
	console.log("[esbuild] watching… (vendor copy only on initial build — re-run `npm run build` after Pi update)");
	vendorBundle();
} else {
	await Promise.all([build(extensionConfig), build(webviewConfig), build(webviewCssConfig)]);
	vendorBundle();
}

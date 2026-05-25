import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

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
	logLevel: "info",
};

const webviewCssConfig = {
	entryPoints: ["webview/styles.css"],
	bundle: false,
	outfile: "out/webview/styles.css",
	loader: { ".css": "copy" },
	logLevel: "info",
};

if (watch) {
	const ctxA = await context(extensionConfig);
	const ctxB = await context(webviewConfig);
	const ctxC = await context(webviewCssConfig);
	await Promise.all([ctxA.watch(), ctxB.watch(), ctxC.watch()]);
	console.log("[esbuild] watching…");
} else {
	await Promise.all([build(extensionConfig), build(webviewConfig), build(webviewCssConfig)]);
}

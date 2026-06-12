// Resolves how to spawn Pi for the chat backend.
//
// The .vsix bundles Pi + hmm-code-pi at out/vendor/. We always spawn from
// there, via Electron's own Node (ELECTRON_RUN_AS_NODE=1) so no system Node
// install is required. `--no-extensions -e <bundled hmm-code-pi>` ensures
// deterministic behavior (no conflicts with whatever the user has at
// ~/.pi/agent/extensions/).
//
// `--approve` trusts the workspace folder so Pi loads its project-local
// resources (`.pi/` settings/skills/prompt-templates) without prompting. Pi
// gates these behind a trust decision, and in our headless RPC mode there is no
// UI to answer the prompt — without --approve a project that has a `.pi/`
// directory would silently run untrusted (project-local resources skipped).
// The user already trusts the folder by opening it in their editor, so we opt
// in on their behalf; hmm-code's own AGENTS.md injection and permission rules
// are read directly and are unaffected either way.
//
// If the bundle is missing the .vsix is broken — we surface a loud warning
// and fall back to `pi` on PATH so the user at least gets *some* response
// rather than a silent failure. That fallback path is unsupported.

import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { resolveLocale } from "./i18n";

export interface PiLaunchConfig {
	/** Executable to spawn. */
	cmd: string;
	/** Args prepended before `--mode rpc`. */
	args: string[];
	/** Environment overrides merged onto process.env. */
	env: NodeJS.ProcessEnv;
	/** Diagnostic label for logs. */
	source: "bundled" | "system";
}

export function getPiLaunchConfig(ctx: vscode.ExtensionContext): PiLaunchConfig {
	const bundledCli = ctx.asAbsolutePath("out/vendor/pi/dist/cli.js");
	const bundledHmmCodePi = ctx.asAbsolutePath("out/vendor/hmm-code-pi/index.ts");

	// Pass the resolved UI locale so the bundled hmm-code-pi (auto-title) can
	// generate session titles in the user's hmm-code.language.
	const lang = resolveLocale();

	if (existsSync(bundledCli) && existsSync(bundledHmmCodePi)) {
		return {
			cmd: process.execPath,
			args: [bundledCli, "--no-extensions", "--approve", "-e", bundledHmmCodePi],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HMM_CODE_LANG: lang },
			source: "bundled",
		};
	}

	// Bundle is missing — surface loudly. Reinstall the .vsix is the real fix.
	const cliMissing = !existsSync(bundledCli);
	const hmmMissing = !existsSync(bundledHmmCodePi);
	void vscode.window.showWarningMessage(
		`Hmm-code: bundled Pi not found — falling back to system 'pi' on PATH. ` +
			`Reinstall the .vsix to fix. ` +
			`(missing: ${[cliMissing ? bundledCli : "", hmmMissing ? bundledHmmCodePi : ""].filter(Boolean).join(", ")})`,
	);
	console.error(
		`[hmm-code] bundled Pi missing — bundledCli=${cliMissing ? "MISSING" : "ok"} (${bundledCli}), bundledHmmCodePi=${hmmMissing ? "MISSING" : "ok"} (${bundledHmmCodePi}), extensionPath=${ctx.extensionPath}`,
	);
	return {
		cmd: "pi",
		args: [],
		env: { ...process.env, HMM_CODE_LANG: lang },
		source: "system",
	};
}

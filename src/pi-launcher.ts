// Resolves how to spawn Pi for the chat backend.
//
// The .vsix bundles Pi + hmm-code-pi at out/vendor/. We always spawn from
// there, via Electron's own Node (ELECTRON_RUN_AS_NODE=1) so no system Node
// install is required. `--no-extensions -e <bundled hmm-code-pi>` ensures
// deterministic behavior (no conflicts with whatever the user has at
// ~/.pi/agent/extensions/).
//
// If the bundle is missing the .vsix is broken — we surface a loud warning
// and fall back to `pi` on PATH so the user at least gets *some* response
// rather than a silent failure. That fallback path is unsupported.

import { existsSync } from "node:fs";
import * as vscode from "vscode";

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

	if (existsSync(bundledCli) && existsSync(bundledHmmCodePi)) {
		return {
			cmd: process.execPath,
			args: [bundledCli, "--no-extensions", "-e", bundledHmmCodePi],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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
		env: { ...process.env },
		source: "system",
	};
}

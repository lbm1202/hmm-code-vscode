// Resolves how to spawn Pi for the chat backend.
//
// Three sources, in order:
//   1. User override (`hmm-code.piBinary` setting) — points to an installed Pi
//      binary. Useful for power users who want their own Pi version or for
//      platforms we don't bundle for.
//   2. Bundled Pi at out/vendor/pi/dist/cli.js — shipped inside the .vsix.
//      Spawned via the Electron host's own Node runtime so we don't depend on
//      a system Node install.
//   3. System PATH `pi` — last-resort fallback when the bundle is missing
//      (e.g. running from a watch build that hasn't run the vendor copy).
//
// The chosen mode also dictates whether hmm-code-pi extension gets injected
// via `-e` (bundled mode) or assumed to be auto-discovered from
// ~/.pi/agent/extensions/ (external mode).

import { existsSync } from "node:fs";
import * as vscode from "vscode";

export interface PiLaunchConfig {
	/** Executable to spawn. */
	cmd: string;
	/** Args prepended before `--mode rpc`. */
	args: string[];
	/** Environment overrides merged onto process.env. */
	env: NodeJS.ProcessEnv;
	/** Diagnostic label for logs / settings panel. */
	source: "bundled" | "user-override" | "system";
}

export function getPiLaunchConfig(ctx: vscode.ExtensionContext): PiLaunchConfig {
	const settings = vscode.workspace.getConfiguration("hmm-code");
	const customBin = (settings.get<string>("piBinary") ?? "").trim();

	const bundledCli = ctx.asAbsolutePath("out/vendor/pi/dist/cli.js");
	const bundledHmmCodePi = ctx.asAbsolutePath("out/vendor/hmm-code-pi/index.ts");
	const bundledOk = existsSync(bundledCli) && existsSync(bundledHmmCodePi);

	// User explicitly pointed at an external Pi → respect it. Disable Pi's
	// extension auto-discovery and load hmm-code-pi explicitly so the user
	// gets a known-good UI no matter what they have in ~/.pi/agent/extensions/.
	// If bundled hmm-code-pi is missing we fall back to system discovery
	// (assume it's in ~/.pi/agent/extensions/) so a user-set piBinary still
	// works even without the bundle.
	if (customBin) {
		return {
			cmd: customBin,
			args: bundledOk ? ["--no-extensions", "-e", bundledHmmCodePi] : [],
			env: { ...process.env },
			source: "user-override",
		};
	}

	// Bundled Pi — preferred path. Uses Electron's bundled Node (with
	// ELECTRON_RUN_AS_NODE=1) so no system Node install required.
	if (bundledOk) {
		return {
			cmd: process.execPath,
			args: [bundledCli, "--no-extensions", "-e", bundledHmmCodePi],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			source: "bundled",
		};
	}

	// Last resort — assume `pi` is on PATH. This is the unhappy path: the
	// bundled Pi wasn't shipped (build issue, partial install, or stale
	// extension from a pre-bundling release). Loudly tell the user so they
	// don't hit "spawn pi ENOENT" with no context.
	const cliMissing = !existsSync(bundledCli);
	const hmmMissing = !existsSync(bundledHmmCodePi);
	void vscode.window
		.showWarningMessage(
			`Hmm-code: bundled Pi not found — falling back to system 'pi' on PATH. ` +
				`Reinstall the .vsix to fix. ` +
				`(missing: ${[cliMissing ? bundledCli : "", hmmMissing ? bundledHmmCodePi : ""].filter(Boolean).join(", ")})`,
			"Show Output",
		)
		.then((choice) => {
			if (choice === "Show Output") {
				void vscode.commands.executeCommand("workbench.action.toggleDevTools");
			}
		});
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

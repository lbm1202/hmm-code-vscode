import * as vscode from "vscode";
import { ChatBackend } from "./chat-backend";
import { SessionsViewProvider } from "./sessions-view";
import { ChatPanel } from "./chat-panel";
import { getPiLaunchConfig } from "./pi-launcher";
import { SettingsPanel } from "./settings-panel";
import { clearI18nCache, initI18n, t } from "./i18n";

export function activate(ctx: vscode.ExtensionContext): void {
	// Load locale dictionaries (l10n/<locale>.json) before any webview renders.
	initI18n(ctx.extensionPath);
	// Language is baked into each webview's HTML at render time, so a change
	// needs a window reload to take effect everywhere. Offer it.
	ctx.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration("hmm-code.language")) return;
			clearI18nCache();
			vscode.window
				.showInformationMessage(t("host.languageChanged"), t("host.reloadNow"))
				.then((pick) => {
					if (pick) vscode.commands.executeCommand("workbench.action.reloadWindow");
				});
		}),
	);

	// Resolve how to spawn Pi (bundled / user-override / system fallback) once.
	// Every ChatBackend instance pulls from this central config so we can swap
	// modes by changing a setting and reloading the window.
	const launch = getPiLaunchConfig(ctx);
	ChatBackend.setLaunchConfig(launch);
	const out = vscode.window.createOutputChannel("Hmm-code");
	ctx.subscriptions.push(out);
	out.appendLine(
		`[hmm-code] Pi launch source: ${launch.source}\n` +
			`  cmd: ${launch.cmd}\n` +
			`  args: ${launch.args.join(" ")}\n` +
			`  extensionPath: ${ctx.extensionPath}`,
	);
	console.log(`[hmm-code] Pi launch source: ${launch.source} (${launch.cmd})`);

	// Sidebar = session list only (chat lives in editor panels). It holds no Pi
	// process, so retainContextWhenHidden isn't needed: the list re-renders from
	// disk whenever the view becomes visible again.
	const provider = new SessionsViewProvider(ctx);

	ctx.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SessionsViewProvider.viewType, provider),
	);

	// Restore editor-area panels across window reloads / VS Code restarts.
	// VS Code calls deserializeWebviewPanel for each panel whose viewType was
	// registered here. We spawn a fresh ChatBackend (pi process); session
	// content can be reloaded via the picker if the user wants to continue.
	ctx.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(ChatPanel.viewType, {
			async deserializeWebviewPanel(panel) {
				ChatPanel.adopt(panel, ctx);
			},
		}),
		vscode.window.registerWebviewPanelSerializer(SettingsPanel.viewType, {
			async deserializeWebviewPanel(panel) {
				SettingsPanel.adopt(panel, ctx);
			},
		}),
	);

	ctx.subscriptions.push(
		vscode.commands.registerCommand("hmm-code.open", async () => {
			await vscode.commands.executeCommand("workbench.view.extension.hmm-code");
			await vscode.commands.executeCommand("hmm-code.chat.focus");
		}),
		vscode.commands.registerCommand("hmm-code.openInPanel", () => {
			ChatPanel.open(ctx);
		}),
		vscode.commands.registerCommand("hmm-code.openSettings", () => {
			SettingsPanel.open(ctx);
		}),
		// Restart every live Pi process (sidebar + any open editor panels).
		// Used by the settings panel after auth changes — Pi caches
		// AuthStorage in memory, so editing auth.json alone is invisible
		// until the process respawns. ChatBackend tracks live instances in
		// a static registry so each one gets its own fresh pi.
		vscode.commands.registerCommand("hmm-code.restartChat", () => {
			ChatBackend.restartAll();
		}),
		// Chat-scoped commands act on the focused chat tab (or the only open one).
		// With no chat panel open there's nothing to act on — say so instead of
		// failing silently.
		vscode.commands.registerCommand("hmm-code.cycleMode", () => {
			withActiveChat((b) => b.prompt("/mode"));
		}),
		vscode.commands.registerCommand("hmm-code.toggleThinking", () => {
			withActiveChat((b) => b.prompt("/thinking-toggle"));
		}),
		vscode.commands.registerCommand("hmm-code.resetDefaults", () => {
			withActiveChat((b) => b.prompt("/reset"));
		}),
		vscode.commands.registerCommand("hmm-code.abort", () => {
			withActiveChat((b) => b.abort());
		}),
		// Clears the "don't show again" flag so the onboarding card can appear
		// again (it still requires no-auth detection). Mainly for support/testing.
		vscode.commands.registerCommand("hmm-code.resetOnboarding", async () => {
			await ctx.globalState.update("hmm-code.onboardingDismissed", undefined);
			void vscode.window.showInformationMessage(
				"Hmm-code: onboarding reset — reload the window to re-evaluate.",
			);
		}),
	);
}

/** Run `fn` on the focused chat panel's backend, or tell the user there's none. */
function withActiveChat(fn: (backend: ChatBackend) => void): void {
	const backend = ChatPanel.activeBackend();
	if (!backend) {
		void vscode.window.showInformationMessage(t("host.noActiveChat"));
		return;
	}
	fn(backend);
}

export function deactivate(): void {
	// No-op: each ChatPanel tears down its PiClient in onDidDispose.
}

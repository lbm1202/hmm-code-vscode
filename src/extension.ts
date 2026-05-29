import * as vscode from "vscode";
import { ChatBackend } from "./chat-backend";
import { ChatViewProvider } from "./chat-view";
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

	const provider = new ChatViewProvider(ctx);

	ctx.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
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
		vscode.commands.registerCommand("hmm-code.cycleMode", () => {
			provider.cyclePrompt("/mode");
		}),
		vscode.commands.registerCommand("hmm-code.toggleThinking", () => {
			provider.cyclePrompt("/thinking-toggle");
		}),
		vscode.commands.registerCommand("hmm-code.resetDefaults", () => {
			provider.cyclePrompt("/reset");
		}),
		vscode.commands.registerCommand("hmm-code.abort", () => {
			provider.abort();
		}),
	);
}

export function deactivate(): void {
	// No-op: ChatViewProvider tears down its PiClient in onDidDispose.
}

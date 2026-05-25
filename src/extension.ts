import * as vscode from "vscode";
import { ChatViewProvider } from "./chat-view";
import { ChatPanel } from "./chat-panel";
import { SettingsPanel } from "./settings-panel";

export function activate(ctx: vscode.ExtensionContext): void {
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
		// Used by the settings panel to dispatch a slash command to the sidebar
		// chat. Settings panel posts {kind:"run-slash"} → opens sidebar →
		// executes this command with the slash string.
		vscode.commands.registerCommand("hmm-code.sendSlash", (slash: string) => {
			if (typeof slash === "string" && slash) provider.cyclePrompt(slash);
		}),
		// Restart the sidebar chat's Pi process. Used by the settings panel
		// after auth changes — Pi caches AuthStorage in memory, so editing
		// auth.json alone is invisible until the pi process is respawned.
		vscode.commands.registerCommand("hmm-code.restartChat", () => {
			provider.restart();
		}),
		vscode.commands.registerCommand("hmm-code.cycleMode", () => {
			provider.cyclePrompt("/mode");
		}),
		vscode.commands.registerCommand("hmm-code.toggleThinking", () => {
			provider.cyclePrompt("/mode-set");
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

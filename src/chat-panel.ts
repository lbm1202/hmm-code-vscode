import * as vscode from "vscode";
import { ChatBackend, renderChatHtml } from "./chat-backend";
import { renderInfoFromContext } from "./info";

/**
 * Editor-area chat panel. Each call to `open()` creates a fresh WebviewPanel
 * with its own ChatBackend (own `pi --mode rpc` process and session).
 *
 * Title: starts as "Hmm-code", then becomes the session name once Pi reports
 * one. The Hmm-code Pi extension auto-generates a name from the first user
 * prompt + first assistant response using code mode's model.
 *
 * Persistence: VS Code re-instantiates webviews after window reload via
 * registered serializers (see extension.ts). The Pi process is gone, so
 * `adopt()` spawns a fresh one — the panel survives, and the webview restores
 * the previous session file from its persisted state.
 */
export class ChatPanel {
	public static readonly viewType = "hmm-code.chatPanel";

	static open(ctx: vscode.ExtensionContext): void {
		const panel = vscode.window.createWebviewPanel(
			ChatPanel.viewType,
			"Hmm-code",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(ctx.extensionUri, "out", "webview"),
					vscode.Uri.joinPath(ctx.extensionUri, "media"),
				],
			},
		);
		ChatPanel.attach(panel, ctx);
	}

	/** Re-attach a panel that VS Code restored from a previous session. */
	static adopt(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		// Webview options aren't preserved across serialization — re-set them.
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(ctx.extensionUri, "out", "webview"),
				vscode.Uri.joinPath(ctx.extensionUri, "media"),
			],
		};
		ChatPanel.attach(panel, ctx);
	}

	private static attach(panel: vscode.WebviewPanel, ctx: vscode.ExtensionContext): void {
		// Tab icon — green "H" logo so the chat tab is recognizable at a glance.
		panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "tab-icon.svg");
		panel.webview.html = renderChatHtml(panel.webview, ctx.extensionUri, renderInfoFromContext(ctx));
		const backend = new ChatBackend(panel.webview, {
			// A named session sets the tab title; an empty name (fresh/unnamed
			// session — e.g. after deleting the active session) resets it to the
			// default, so the tab never keeps a stale name from a gone session.
			onSessionName: (name) => {
				panel.title = name && name.trim() ? name : "Hmm-code";
			},
		});
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME;
		backend.start(cwd);
		panel.onDidDispose(() => backend.dispose());
	}
}

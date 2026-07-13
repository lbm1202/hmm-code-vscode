import * as vscode from "vscode";
import { ChatBackend, renderChatHtml } from "./chat-backend";
import { renderInfoFromContext } from "./info";

export class ChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "hmm-code.chat";
	private backend: ChatBackend | undefined;

	constructor(private readonly ctx: vscode.ExtensionContext) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "out", "webview")],
		};
		view.webview.html = renderChatHtml(view.webview, this.ctx.extensionUri, renderInfoFromContext(this.ctx));
		this.backend = new ChatBackend(view.webview, {
			onSessionName: (name) => {
				// Update the sidebar view title to mirror the active session name.
				view.title = name;
				view.description = undefined;
			},
			isVisible: () => view.visible,
			onAttention: (count, tooltip) => {
				// Activity-bar badge while Pi waits for a dialog answer and the
				// view is hidden. Cleared on answer (count 0) or on reveal below.
				view.badge = count > 0 ? { value: count, tooltip } : undefined;
			},
			reveal: () => void vscode.commands.executeCommand("hmm-code.chat.focus"),
		});
		view.onDidChangeVisibility(() => {
			// Revealing the view shows the pending dialog — the badge served its
			// purpose. (The toast, if still up, is dismissed by the user.)
			if (view.visible) view.badge = undefined;
		});
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME;
		this.backend.start(cwd);
		view.onDidDispose(() => {
			this.backend?.dispose();
			this.backend = undefined;
		});
	}

	// ── Public hooks for command palette / keybindings ───────────────────────
	cyclePrompt(slashCommand: string): void {
		this.backend?.prompt(slashCommand);
	}
	abort(): void {
		this.backend?.abort();
	}
}

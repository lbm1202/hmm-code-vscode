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
	restart(): void {
		this.backend?.restart();
	}
}

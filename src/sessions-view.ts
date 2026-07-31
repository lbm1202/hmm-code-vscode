// Sidebar session list. This view replaced the old sidebar chat: chat now runs
// ONLY in editor panels (chat-panel.ts), and the sidebar is a browser for the
// sessions of the current workspace directory — click one to open it in a panel.
//
// It holds NO Pi process. Everything it does is plain file I/O through
// session-manager (list/rename/delete) plus host services (usage lookups), so
// the sidebar costs nothing while no chat is open.

import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { ensureFreshOAuth, OAUTH_USAGE_PROVIDERS } from "./auth-refresh";
import { ChatBackend } from "./chat-backend";
import { ChatPanel } from "./chat-panel";
import { getWebviewMessages, resolveLocale, t } from "./i18n";
import { renderInfoFromContext } from "./info";
import { noAuthDetected } from "./onboarding";
import { collectCascade, deleteSession, listSessions, renameSession } from "./session-manager";
import { collectSubscriptionUsage } from "./sub-usage";
import { buildCsp, jsonForScript, makeNonce } from "./webview-html";

/** webview → host */
type FromView =
	| { kind: "list" }
	| { kind: "open"; file: string }
	| { kind: "new" }
	| { kind: "rename"; file: string; name: string }
	| { kind: "delete"; file: string }
	| { kind: "settings" }
	| { kind: "usage"; token?: number };

function sessionsDirFor(cwd: string): string {
	const dirName = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(homedir(), ".pi", "agent", "sessions", dirName);
}

export class SessionsViewProvider implements vscode.WebviewViewProvider {
	// View id kept from the old sidebar chat: it's baked into the
	// `hmm-code.chat.focus` command and into users' view layouts, so renaming it
	// would move the view back to its default slot for everyone.
	public static readonly viewType = "hmm-code.chat";

	private view: vscode.WebviewView | undefined;
	private watcher: FSWatcher | undefined;
	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(private readonly ctx: vscode.ExtensionContext) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "out", "webview")],
		};
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage((msg: FromView) => void this.handle(msg));

		// Keep the list in sync with the panels: opening/closing/switching a
		// session changes which rows are marked "open in a tab".
		ChatPanel.onOpenSessionsChanged(() => this.refresh());
		ChatPanel.onAttentionChanged((count, tooltip) => {
			view.badge = count > 0 ? { value: count, tooltip } : undefined;
		});

		view.onDidChangeVisibility(() => {
			if (!view.visible) return;
			// Revealing the sidebar shows the pending-dialog badge's purpose.
			view.badge = undefined;
			this.refresh();
		});
		view.onDidDispose(() => {
			ChatPanel.onOpenSessionsChanged(undefined);
			ChatPanel.onAttentionChanged(undefined);
			this.stopWatching();
			this.view = undefined;
		});

		this.startWatching();
		this.refresh();
	}

	/** Re-read the sessions directory and push the list. Debounced by the
	 *  watcher; direct calls (visibility, panel changes) go through immediately. */
	refresh(): void {
		const view = this.view;
		if (!view) return;
		const cwd = this.cwd();
		void view.webview.postMessage({
			kind: "sessions",
			sessions: listSessions(cwd),
			open: ChatPanel.openSessionFiles(),
			noAuth: noAuthDetected(),
		});
	}

	private cwd(): string {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? "";
	}

	/** Watch the session directory so sessions started/renamed/ended in a panel
	 *  (or in a TUI pi elsewhere) show up without reopening the sidebar. Pi
	 *  appends to the JSONL on every turn, so coalesce bursts into one refresh. */
	private startWatching(): void {
		this.stopWatching();
		try {
			this.watcher = watch(sessionsDirFor(this.cwd()), { persistent: false }, () => {
				// Hidden view: skip entirely — onDidChangeVisibility refreshes on
				// reveal, so there's nothing to keep warm. A running turn appends to
				// the session JSONL continuously, hence the coalescing window.
				if (!this.view?.visible) return;
				if (this.refreshTimer) clearTimeout(this.refreshTimer);
				this.refreshTimer = setTimeout(() => {
					this.refreshTimer = undefined;
					this.refresh();
				}, 1500);
				this.refreshTimer.unref?.();
			});
		} catch {
			// No sessions directory yet (first run in this workspace) — the list
			// is empty anyway, and the first session created from here triggers a
			// refresh through the panel hook.
		}
	}

	private stopWatching(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		try {
			this.watcher?.close();
		} catch {
			/* already closed */
		}
		this.watcher = undefined;
	}

	private async handle(msg: FromView): Promise<void> {
		switch (msg?.kind) {
			case "list":
				// A fresh watch target too: the directory may have been created
				// since boot (first session in a new workspace).
				if (!this.watcher) this.startWatching();
				this.refresh();
				return;
			case "open":
				ChatPanel.openSession(this.ctx, msg.file);
				return;
			case "new":
				ChatPanel.open(this.ctx);
				return;
			case "rename":
				try {
					renameSession(msg.file, msg.name);
				} catch (err) {
					void vscode.window.showErrorMessage(`Rename failed: ${(err as Error).message}`);
				}
				this.refresh();
				return;
			case "delete": {
				const cwd = this.cwd();
				// Delete cascades to descendants. Any panel holding one of them must
				// move off it FIRST so Pi isn't left appending to a deleted file.
				try {
					const cascade = collectCascade(msg.file, cwd);
					await ChatBackend.detachFromSessions(cascade);
					deleteSession(msg.file, cwd);
				} catch (err) {
					void vscode.window.showErrorMessage(`Delete failed: ${(err as Error).message}`);
				}
				this.refresh();
				return;
			}
			case "settings":
				void vscode.commands.executeCommand("hmm-code.openSettings");
				return;
			case "usage": {
				// Same flow as the chat topbar button: refresh expired OAuth first
				// (no LLM turn), then collect per-provider plan usage. Refresh needs
				// a live Pi; with no panel open it's skipped and the lookup still
				// works as long as the token hasn't expired.
				for (const p of OAUTH_USAGE_PROVIDERS) {
					await ensureFreshOAuth(p, (s) => ChatBackend.promptFirst(s));
				}
				void this.view?.webview.postMessage({
					kind: "usage",
					token: msg.token,
					entries: await collectSubscriptionUsage(),
				});
				return;
			}
		}
	}

	private html(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, "out", "webview", "sessions.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, "out", "webview", "styles.css"),
		);
		const csp = buildCsp(webview, nonce, webview.cspSource);
		const infoLiteral = jsonForScript(renderInfoFromContext(this.ctx));
		const i18nLiteral = jsonForScript(getWebviewMessages());
		return `<!DOCTYPE html>
<html lang="${resolveLocale()}">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${t("view.sessions.title")}</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">window.__HMM_INFO = ${infoLiteral}; window.__HMM_I18N = ${i18nLiteral};</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

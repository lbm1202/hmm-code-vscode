import * as vscode from "vscode";
import { ChatBackend, renderChatHtml } from "./chat-backend";
import { renderInfoFromContext } from "./info";

interface PanelEntry {
	panel: vscode.WebviewPanel;
	backend: ChatBackend;
	/** Session file the panel's Pi currently holds — reported by the backend's
	 *  get_state sniff. Undefined until the first state lands. */
	sessionFile?: string;
	/** Session this panel was opened ON, until the switch actually lands. Pi
	 *  reports its own bootstrap session first, so without this a second click
	 *  on the same row (during the ~1s switch) would open a duplicate panel. */
	requestedSession?: string;
	/** Pending input-wait count, aggregated into the sidebar badge. */
	attention: number;
}

/** macOS/Windows preserve path case but fold it on disk, so session paths from
 *  different sources (workspace cwd vs Pi's reported sessionFile) can disagree
 *  in case for the same file. Compare folded. */
function samePath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	return a.toLowerCase() === b.toLowerCase();
}

/**
 * Editor-area chat panel — the ONLY place chat runs. Each panel owns its own
 * ChatBackend (its own `pi --mode rpc` process and session); the sidebar is a
 * session list that opens panels (see sessions-view.ts).
 *
 * Session→panel is 1:1: opening a session that's already in a panel reveals
 * that tab instead of spawning a second Pi on the same session file.
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

	private static entries = new Set<PanelEntry>();
	private static _active: PanelEntry | undefined;
	private static openSessionsListener: (() => void) | undefined;
	private static attentionListener: ((count: number, tooltip: string) => void) | undefined;

	/** Open a fresh chat panel. `initialSession`, when given, is the session the
	 *  webview switches to once Pi is ready (instead of its persisted last one). */
	static open(ctx: vscode.ExtensionContext, initialSession?: string): void {
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
		ChatPanel.attach(panel, ctx, initialSession);
	}

	/** Open `file` in a panel: reveal the tab already holding it, else open a
	 *  new panel pointed at it. Keeps session→panel 1:1 so two Pi processes
	 *  never write the same session JSONL. */
	static openSession(ctx: vscode.ExtensionContext, file: string): void {
		for (const e of ChatPanel.entries) {
			if (samePath(e.sessionFile, file) || samePath(e.requestedSession, file)) {
				e.panel.reveal();
				return;
			}
		}
		ChatPanel.open(ctx, file);
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
		// No initialSession: a restored panel's webview still has its persisted
		// lastSessionFile and resumes that on its own.
		ChatPanel.attach(panel, ctx);
	}

	/** Backend of the focused (or most recently focused) chat panel — the target
	 *  for command-palette actions like mode cycling and abort. */
	static activeBackend(): ChatBackend | undefined {
		if (ChatPanel._active && ChatPanel.entries.has(ChatPanel._active)) {
			return ChatPanel._active.backend;
		}
		// Fall back to the only open panel, if there is exactly one.
		if (ChatPanel.entries.size === 1) return [...ChatPanel.entries][0].backend;
		return undefined;
	}

	/** Session files currently held by open panels (for the sidebar's
	 *  "open in a tab" marker). */
	static openSessionFiles(): string[] {
		const out: string[] = [];
		for (const e of ChatPanel.entries) {
			const file = e.requestedSession ?? e.sessionFile;
			if (file) out.push(file);
		}
		return out;
	}

	/** Sidebar hook: fires whenever the set of panel-held sessions changes. */
	static onOpenSessionsChanged(cb: (() => void) | undefined): void {
		ChatPanel.openSessionsListener = cb;
	}

	/** Sidebar hook: aggregated input-wait count across panels (activity-bar badge). */
	static onAttentionChanged(cb: ((count: number, tooltip: string) => void) | undefined): void {
		ChatPanel.attentionListener = cb;
	}

	private static notifyOpenSessions(): void {
		ChatPanel.openSessionsListener?.();
	}

	private static notifyAttention(tooltip: string): void {
		let total = 0;
		for (const e of ChatPanel.entries) total += e.attention;
		ChatPanel.attentionListener?.(total, tooltip);
	}

	private static attach(
		panel: vscode.WebviewPanel,
		ctx: vscode.ExtensionContext,
		initialSession?: string,
	): void {
		// Tab icon — "H" logo so the chat tab is recognizable at a glance.
		panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "tab-icon.svg");
		panel.webview.html = renderChatHtml(panel.webview, ctx.extensionUri, renderInfoFromContext(ctx), {
			initialSession,
		});
		const entry: PanelEntry = {
			panel,
			backend: undefined as unknown as ChatBackend,
			requestedSession: initialSession,
			attention: 0,
		};
		const backend = new ChatBackend(panel.webview, {
			// A named session sets the tab title; an empty name (fresh/unnamed
			// session — e.g. after deleting the active session) resets it to the
			// default, so the tab never keeps a stale name from a gone session.
			onSessionName: (name) => {
				panel.title = name && name.trim() ? name : "Hmm-code";
			},
			// Which session this panel holds — drives session→panel reuse and the
			// sidebar's open-session marker.
			onSessionFile: (file) => {
				if (samePath(entry.sessionFile, file)) return;
				entry.sessionFile = file;
				// The requested session has landed — stop shadowing the real one.
				if (samePath(entry.requestedSession, file)) entry.requestedSession = undefined;
				ChatPanel.notifyOpenSessions();
			},
			// Editor panels have no badge surface of their own — the count goes to
			// the sidebar view's activity-bar badge, aggregated across panels. A
			// hidden tab still gets the input-wait toast (the panel counts as
			// visible only when its tab is).
			isVisible: () => panel.visible,
			onAttention: (count, tooltip) => {
				entry.attention = count;
				ChatPanel.notifyAttention(tooltip);
			},
			reveal: () => panel.reveal(),
			memento: ctx.globalState,
		});
		entry.backend = backend;
		ChatPanel.entries.add(entry);
		ChatPanel._active = entry;
		ChatPanel.notifyOpenSessions();

		panel.onDidChangeViewState((e) => {
			if (e.webviewPanel.active) ChatPanel._active = entry;
			// Focusing the tab shows any pending dialog — clear its badge share.
			if (e.webviewPanel.visible && entry.attention > 0) {
				entry.attention = 0;
				ChatPanel.notifyAttention("");
			}
		});

		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME;
		backend.start(cwd);
		panel.onDidDispose(() => {
			backend.dispose();
			ChatPanel.entries.delete(entry);
			if (ChatPanel._active === entry) ChatPanel._active = undefined;
			ChatPanel.notifyOpenSessions();
			ChatPanel.notifyAttention("");
		});
	}
}

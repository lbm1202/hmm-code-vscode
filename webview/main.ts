// Webview entry. Mount the DOM, wire pickers + prompt + dispatch, and
// register the topbar buttons. Everything else lives in focused modules.

import { els, initDom, setEmptyVisibility } from "./dom";
import { wireDispatch } from "./dispatch";
import { updateModeColor, wirePickers } from "./pickers";
import { wirePrompt } from "./prompt";
import { FROM_WEBVIEW } from "./protocol";
import { showSessionPicker } from "./session-picker";
import { wireSlashMenu } from "./slash";
import { post, runtime, ui } from "./state";
import { wireTodoPanel } from "./todo-panel";

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

initDom(app);
wirePickers();
wirePrompt();
wireSlashMenu();
wireDispatch();
wireTodoPanel();
updateModeColor();

// ── Topbar buttons ───────────────────────────────────────────────────────────
const e = els();

e.btnNew.addEventListener("click", () =>
	post({ kind: FROM_WEBVIEW.COMMAND, command: { type: "new_session" } }),
);

e.btnSessions.addEventListener("click", () => {
	// Open the picker immediately so the button feels responsive — render the
	// cached list if we have one, otherwise a loading state. Then refresh: the
	// SESSIONS response re-renders the open picker in place (see dispatch).
	showSessionPicker(ui.sessions, { loading: true });
	post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
});

// Open the standalone settings panel in a new editor tab. Host listens on
// OPEN_SETTINGS and runs vscode.commands.executeCommand("hmm-code.openSettings").
e.btnSettings.addEventListener("click", () => {
	post({ kind: FROM_WEBVIEW.OPEN_SETTINGS });
});

// Auto-approve now lives as a toggle row inside the mode picker popover
// (pickers.ts), which posts the same /auto-approve SLASH command. Pi flips
// state.autoApprove and broadcasts setStatus("auto-approve", …) back; the
// dispatch handler updates ui.autoApprove so the popover reflects it on reopen.

// Manual compaction — dispatches /compact (handled by hmm-code-pi's command,
// which calls ctx.compact + notifies). Same path as the TUI slash.
e.btnCompact.addEventListener("click", () => {
	post({ kind: FROM_WEBVIEW.SLASH, text: "/compact" });
});

// Reset overridden model/thinking back to the mode defaults. Shown only while
// overridden (dispatch toggles its visibility on the OVERRIDDEN status).
e.btnReset.addEventListener("click", () => {
	post({ kind: FROM_WEBVIEW.PROMPT, text: "/reset" });
});

// ctx-pill click → token-usage modal for the current session subtree (own +
// child sessions). Host computes; dispatch's USAGE handler opens the modal.
e.ctxPill.title = "Click for token usage";
e.ctxPill.addEventListener("click", () => {
	const file = runtime.currentSessionFile;
	if (file) post({ kind: FROM_WEBVIEW.REQUEST_USAGE, file });
});

setEmptyVisibility();

// Ctrl/Cmd-click on a `.file-link` (rendered by tool summaries + edit-diff
// headers) opens the file in the editor area. Plain click falls through so
// the surrounding <summary> can still toggle the <details> block.
document.addEventListener(
	"click",
	(ev) => {
		const onlyMod = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey;
		if (!onlyMod) return;
		const el = ev.target as HTMLElement | null;
		const fileEl = el?.closest?.(".file-link");
		if (fileEl) {
			const path = fileEl.getAttribute("data-file-path");
			if (!path) return;
			ev.preventDefault();
			ev.stopPropagation();
			post({ kind: FROM_WEBVIEW.OPEN_FILE, path });
			return;
		}
		// Ctrl/Cmd-click on a bash command summary / inline block → open the full
		// command text in a scratch editor tab.
		const cmdEl = el?.closest?.(".bash-cmd-link");
		if (cmdEl) {
			const cmd = cmdEl.getAttribute("data-bash-cmd");
			if (!cmd) return;
			ev.preventDefault();
			ev.stopPropagation();
			post({ kind: FROM_WEBVIEW.OPEN_TEXT, text: cmd, language: "shellscript" });
		}
	},
	true, // capture: beat the <summary> default toggle
);

// Track Ctrl/Cmd modifier on body so `.file-link:hover` can flip to an
// underlined "this is clickable" style only while the user is actually
// holding the modifier (avoids permanent link-noise on every summary).
const updateModDown = (down: boolean) => document.body.classList.toggle("mod-down", down);
document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey) updateModDown(true);
});
document.addEventListener("keyup", (e) => {
	if (!e.ctrlKey && !e.metaKey) updateModDown(false);
});
window.addEventListener("blur", () => updateModDown(false));

// Handshake: tell the host we're listening now. The host's eager READY (posted
// synchronously during resolveWebview, before this script loaded) is dropped,
// so without this the boot LIST_SESSIONS / auto-resume never fire and the
// session list stays empty until the user clicks the session button. The host
// replies with READY → the dispatch READY handler loads sessions + resumes.
post({ kind: FROM_WEBVIEW.WEBVIEW_READY });

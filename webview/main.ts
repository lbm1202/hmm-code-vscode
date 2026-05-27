// Webview entry. Mount the DOM, wire pickers + prompt + dispatch, and
// register the topbar buttons. Everything else lives in focused modules.

import { els, initDom, setEmptyVisibility } from "./dom";
import { wireDispatch } from "./dispatch";
import { updateModeColor, wirePickers } from "./pickers";
import { wirePrompt } from "./prompt";
import { FROM_WEBVIEW } from "./protocol";
import { showSessionPicker } from "./session-picker";
import { post, ui } from "./state";

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

initDom(app);
wirePickers();
wirePrompt();
wireDispatch();
updateModeColor();

// ── Topbar buttons ───────────────────────────────────────────────────────────
const e = els();

e.btnNew.addEventListener("click", () =>
	post({ kind: FROM_WEBVIEW.COMMAND, command: { type: "new_session" } }),
);

e.btnSessions.addEventListener("click", () => {
	// Refresh list, then open the modal (post-list-sessions response sets ui.sessions).
	post({ kind: FROM_WEBVIEW.LIST_SESSIONS });
	setTimeout(() => showSessionPicker(ui.sessions), 80);
});

// Open the standalone settings panel in a new editor tab. Host listens on
// OPEN_SETTINGS and runs vscode.commands.executeCommand("hmm-code.openSettings").
e.btnSettings.addEventListener("click", () => {
	post({ kind: FROM_WEBVIEW.OPEN_SETTINGS });
});

// Auto-approve toggle — sends /auto-approve via the SLASH channel so the
// command runs Pi-side without appending a user bubble. Pi extension flips
// state.autoApprove and broadcasts setStatus("auto-approve", "on"|"off")
// back, which dispatch.ts handler renders on the button.
// (No webview-level keyboard shortcut: VS Code grabs most Ctrl/Cmd-modified
//  combos before the webview sees them. Use the button or Pi TUI's
//  Ctrl+Shift+A shortcut instead.)
e.btnAutoApprove.addEventListener("click", () => {
	post({ kind: FROM_WEBVIEW.SLASH, text: "/auto-approve" });
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
		const target = (ev.target as HTMLElement | null)?.closest?.(".file-link");
		if (!target) return;
		const path = target.getAttribute("data-file-path");
		if (!path) return;
		ev.preventDefault();
		ev.stopPropagation();
		post({ kind: FROM_WEBVIEW.OPEN_FILE, path });
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

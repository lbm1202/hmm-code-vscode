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

setEmptyVisibility();

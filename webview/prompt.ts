// Prompt textarea + send/abort button + key handlers (Enter, Shift+Enter, Tab cycle).
//
// Note: prompt.ts and turn-lifecycle.ts have a static import cycle (prompt
// imports ensureTurn, turn-lifecycle imports updateSendButton). ESM handles
// the cycle because each side only USES the import inside function bodies,
// not at module top-level evaluation.

import { appendUserBubble, els } from "./dom";
import { t } from "./i18n";
import { FROM_WEBVIEW, MODE_NAMES } from "./protocol";
import { post, runtime, ui } from "./state";
import { ensureTurn } from "./turn-lifecycle";

const DEFAULT_PLACEHOLDER = t("chat.promptPlaceholder");

export function doSend(): void {
	if (runtime.turnInFlight || runtime.pendingQuestionCount > 0) return; // blocked
	const e = els();
	const text = e.prompt.value.trim();
	if (!text) return;
	appendUserBubble(text);
	e.prompt.value = "";
	runtime.turnInFlight = true;
	ensureTurn(); // creates the standalone status row right away
	post({ kind: FROM_WEBVIEW.PROMPT, text });
	updateSendButton();
}

/** Send button doubles as Stop while a turn is in flight. */
export function updateSendButton(): void {
	const e = els();
	const send = e.send;
	send.textContent = runtime.turnInFlight ? "■" : "↑";
	send.title = runtime.turnInFlight ? t("chat.abortTitle") : t("chat.sendTitle");
	send.classList.toggle("stop", runtime.turnInFlight);
	updatePromptDisabled();
}

/** Block prompt input while turnInFlight or pendingQuestionCount > 0.
 *  Send button stays enabled — it doubles as Abort when turnInFlight. */
export function updatePromptDisabled(): void {
	const e = els();
	const blocked = runtime.turnInFlight || runtime.pendingQuestionCount > 0;
	e.prompt.disabled = blocked;
	e.prompt.classList.toggle("disabled", blocked);
	e.prompt.setAttribute(
		"placeholder",
		blocked
			? runtime.turnInFlight
				? t("chat.modelWorking")
				: t("chat.waitingInput")
			: DEFAULT_PLACEHOLDER,
	);
	// Block session-switching while a turn is mid-flight: switching mid-stream
	// makes Pi drop the in-progress response.
	const blockSession = runtime.turnInFlight;
	(e.btnNew as HTMLButtonElement).disabled = blockSession;
	(e.btnSessions as HTMLButtonElement).disabled = blockSession;
	e.btnNew.classList.toggle("disabled", blockSession);
	e.btnSessions.classList.toggle("disabled", blockSession);
	const reason = blockSession ? t("chat.blockSwitchReason") : "";
	e.btnNew.title = blockSession ? reason : t("chat.newSessionBtn");
	e.btnSessions.title = blockSession ? reason : t("chat.resumeSessionBtn");
}

/** Show/hide the "reset to defaults" button based on runtime.isOverridden. */
export function updateResetVisibility(): void {
	els().btnReset.classList.toggle("hidden", !runtime.isOverridden);
}

/** Wire send button + prompt key handlers + reset button. Call once at boot. */
export function wirePrompt(): void {
	const e = els();
	e.send.addEventListener("click", () => {
		if (runtime.turnInFlight) post({ kind: FROM_WEBVIEW.ABORT });
		else doSend();
	});
	e.prompt.addEventListener("keydown", (ev) => {
		// IME composing: never intercept — let the input method finish first.
		if ((ev as any).isComposing || ev.keyCode === 229) return;
		if (ev.key === "Enter" && !ev.shiftKey) {
			ev.preventDefault();
			doSend();
			return;
		}
		// Shift+Enter — insert newline EXPLICITLY. Relying on the textarea's
		// default newline behavior turned out to be unreliable in SSH-remote
		// VS Code webviews (some intermediate layer eats the keystroke before
		// the textarea sees it). Doing the splice ourselves guarantees it
		// works in every environment.
		if (ev.key === "Enter" && ev.shiftKey) {
			ev.preventDefault();
			const ta = e.prompt;
			const start = ta.selectionStart ?? ta.value.length;
			const end = ta.selectionEnd ?? ta.value.length;
			const before = ta.value.slice(0, start);
			const after = ta.value.slice(end);
			ta.value = before + "\n" + after;
			ta.selectionStart = ta.selectionEnd = start + 1;
			// Fire an input event so any consumer (e.g. autosize / dirty
			// tracking) reacts the same as a real keystroke would.
			ta.dispatchEvent(new Event("input", { bubbles: true }));
			return;
		}
		if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
			const dir = ev.shiftKey ? -1 : 1;
			ev.preventDefault();
			const idx = MODE_NAMES.indexOf(ui.mode as any);
			const next = MODE_NAMES[(idx + dir + MODE_NAMES.length) % MODE_NAMES.length];
			post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${next}` });
		}
	});
	e.btnReset.addEventListener("click", () => post({ kind: FROM_WEBVIEW.PROMPT, text: "/reset" }));
}

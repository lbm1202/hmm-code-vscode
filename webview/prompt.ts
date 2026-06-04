// Prompt textarea + send/abort button + key handlers (Enter, Shift+Enter, Tab cycle).
//
// Note: prompt.ts and turn-lifecycle.ts have a static import cycle (prompt
// imports ensureTurn, turn-lifecycle imports updateSendButton). ESM handles
// the cycle because each side only USES the import inside function bodies,
// not at module top-level evaluation.

import {
	clearAttachments,
	getAttachmentsForBubble,
	getAttachmentsForSend,
	wireAttachments,
} from "./attachments";
import { appendUserBubble, els } from "./dom";
import { t } from "./i18n";
import { updateModeColor } from "./pickers";
import { FROM_WEBVIEW, MODE_NAMES } from "./protocol";
import { hideSlashMenu, isCleanCommand } from "./slash";
import { post, runtime, ui } from "./state";
import { ensureTurn } from "./turn-lifecycle";

const DEFAULT_PLACEHOLDER = t("chat.promptPlaceholder");

/** Grow the textarea to fit its content (one line → up to the CSS max-height,
 *  then it scrolls). Reset to "auto" first so it can also shrink. */
export function autosizePrompt(): void {
	const ta = els().prompt;
	ta.style.height = "auto";
	ta.style.height = `${ta.scrollHeight}px`;
}

export function doSend(): void {
	if (runtime.turnInFlight || runtime.compacting || runtime.pendingQuestionCount > 0) return; // blocked
	const e = els();
	const text = e.prompt.value.trim();
	const images = getAttachmentsForSend();
	const bubbleImages = getAttachmentsForBubble(); // capture names before clear
	if (!text && images.length === 0) return;
	hideSlashMenu();
	// A recognized extension command (e.g. /mode, /reset, /compact) runs a
	// handler with no LLM turn. Route it straight to Pi without echoing a user
	// bubble or arming the optimistic spinner — otherwise the spinner would
	// hang forever (no turn_end ever arrives) and the chat would show a stray
	// "/command" message. If the command does start a turn, the real turn_start
	// event arms the spinner. Unknown slashes / skills / templates fall through
	// to the normal send path (they go to the model and want the echo).
	// Attachments are never a clean command — fall through so the images send.
	if (images.length === 0 && isCleanCommand(text)) {
		e.prompt.value = "";
		post({ kind: FROM_WEBVIEW.SLASH, text });
		return;
	}
	appendUserBubble(text, bubbleImages);
	e.prompt.value = "";
	autosizePrompt(); // collapse back to a single line
	clearAttachments();
	runtime.turnInFlight = true;
	ensureTurn(); // creates the standalone status row right away
	post({ kind: FROM_WEBVIEW.PROMPT, text, images });
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
	const blocked = runtime.turnInFlight || runtime.compacting || runtime.pendingQuestionCount > 0;
	e.prompt.disabled = blocked;
	e.prompt.classList.toggle("disabled", blocked);
	e.prompt.setAttribute(
		"placeholder",
		blocked
			? runtime.compacting
				? t("chat.compacting")
				: runtime.turnInFlight
					? t("chat.modelWorking")
					: t("chat.waitingInput")
			: DEFAULT_PLACEHOLDER,
	);
	// Block session-switching while a turn is mid-flight or compacting: switching
	// mid-stream makes Pi drop the in-progress response / compaction.
	const blockSession = runtime.turnInFlight || runtime.compacting;
	(e.btnNew as HTMLButtonElement).disabled = blockSession;
	(e.btnSessions as HTMLButtonElement).disabled = blockSession;
	e.btnNew.classList.toggle("disabled", blockSession);
	e.btnSessions.classList.toggle("disabled", blockSession);
	const reason = blockSession ? t("chat.blockSwitchReason") : "";
	e.btnNew.title = blockSession ? reason : t("chat.newSessionBtn");
	e.btnSessions.title = blockSession ? reason : t("chat.resumeSessionBtn");
}

/** Wire send button + prompt key handlers. Call once at boot. */
export function wirePrompt(): void {
	const e = els();
	e.prompt.addEventListener("input", autosizePrompt);
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
			// tracking) reacts the same as a real keystroke would. Autosize runs
			// synchronously here, so the height/scrollHeight below are current.
			ta.dispatchEvent(new Event("input", { bubbles: true }));
			// preventDefault above also suppressed the browser's native
			// caret-into-view scroll, so once the box hits its max-height and
			// scrolls, the new line stayed hidden until the next real keystroke.
			// Reveal it: scroll to the bottom when the caret is at the end (the
			// usual case), otherwise nudge the caret's line into view.
			if (ta.selectionEnd === ta.value.length) {
				ta.scrollTop = ta.scrollHeight;
			} else {
				const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 18;
				const caretRow = ta.value.slice(0, ta.selectionEnd).split("\n").length - 1;
				const caretTop = caretRow * lineH;
				if (caretTop < ta.scrollTop) ta.scrollTop = caretTop;
				else if (caretTop + lineH > ta.scrollTop + ta.clientHeight)
					ta.scrollTop = caretTop + lineH - ta.clientHeight;
			}
			return;
		}
		if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
			const dir = ev.shiftKey ? -1 : 1;
			ev.preventDefault();
			const idx = MODE_NAMES.indexOf(ui.mode as any);
			const next = MODE_NAMES[(idx + dir + MODE_NAMES.length) % MODE_NAMES.length];
			if (next === ui.mode) return;
			// Optimistic: advance ui.mode + chip now so rapid Tab presses cycle from
			// the new value (not a stale one) and never re-send the current mode —
			// which would make Pi emit "Already in X mode".
			ui.mode = next;
			els().pickerModeLabel.textContent = next;
			updateModeColor();
			post({ kind: FROM_WEBVIEW.PROMPT, text: `/mode ${next}` });
		}
	});
	wireAttachments();

	// The composer floats over the message list (CSS .prompt-area is absolute),
	// so .messages needs a bottom padding equal to the composer's live height to
	// scroll the last message clear of it. Publish that height as --composer-h on
	// #app; it updates as the input grows (1→5 lines), the footer wraps, or an
	// attachment strip appears.
	const area = e.prompt.closest(".prompt-area") as HTMLElement | null;
	const app = document.getElementById("app");
	if (area && app && typeof ResizeObserver !== "undefined") {
		const sync = () => app.style.setProperty("--composer-h", `${area.offsetHeight}px`);
		new ResizeObserver(sync).observe(area);
		sync();
	}
}

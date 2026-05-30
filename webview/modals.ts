// Inline question cards for select/confirm/input/editor + native-replacement
// confirm/input modal dialogs. Question cards render in the messages area as
// part of the conversation; the dialogs use a backdrop overlay.

import { els, setEmptyVisibility } from "./dom";
import { safeStringify } from "./helpers";
import { t } from "./i18n";
import { FROM_WEBVIEW } from "./protocol";
import { pendingUiRequests, post, runtime } from "./state";
import { ensureTurn, removeStatus } from "./turn-lifecycle";
import type { UiResponse } from "./types";
import { updatePromptDisabled } from "./prompt";

export function showModal(req: any): void {
	// Hide loading status while waiting for user input.
	removeStatus();
	// Track this request so we can re-render after a session switch wipes
	// messagesEl. Don't double-count on a re-render of an existing one.
	if (!pendingUiRequests.has(req.id)) {
		pendingUiRequests.set(req.id, req);
		runtime.pendingQuestionCount++;
	}
	updatePromptDisabled();

	const card = document.createElement("div");
	card.className = "question-card";
	card.dataset.requestId = String(req.id);

	const titleEl = document.createElement("div");
	titleEl.className = "question-title";
	titleEl.textContent = String(req.title ?? "");
	card.appendChild(titleEl);

	const reply = (res: UiResponse) => {
		card.remove();
		setEmptyVisibility();
		if (pendingUiRequests.delete(req.id)) {
			runtime.pendingQuestionCount = Math.max(0, runtime.pendingQuestionCount - 1);
		}
		post({ kind: FROM_WEBVIEW.UI_RESPONSE, response: res });
		// Mid-turn ask_user/request_mode_switch: refresh the status row so it
		// reappears promptly while the AI resumes. But a slash command's picker
		// (e.g. bare `/mode`, `/mode-set`) also arrives as a ui-request with NO
		// turn running — conjuring a status row there strands "응답 대기 중"
		// forever, since no turn_end follows to clear it. Only refresh when a
		// turn is actually in flight.
		if (runtime.turnInFlight) ensureTurn();
	};
	const cancel = () => {
		// Cancel = dismiss the question AND abort the current turn so the AI
		// stops trying to continue without the user's answer.
		reply({ type: "extension_ui_response", id: req.id, cancelled: true });
		post({ kind: FROM_WEBVIEW.ABORT });
	};

	if (req.method === "select") {
		renderSelect(card, req, reply, cancel);
	} else if (req.method === "confirm") {
		renderConfirm(card, req, reply);
	} else if (req.method === "input" || req.method === "editor") {
		renderInputOrEditor(card, req, reply, cancel);
	} else {
		const dbg = document.createElement("pre");
		dbg.className = "tool-input";
		dbg.textContent = `Unknown UI method: ${req.method}\n\n${safeStringify(req)}`;
		card.appendChild(dbg);
		const okBtn = document.createElement("button");
		okBtn.className = "ghost";
		okBtn.textContent = t("chat.modal.close");
		okBtn.addEventListener("click", cancel);
		card.appendChild(okBtn);
	}

	const e = els();
	e.messages.appendChild(card);
	setEmptyVisibility();
	e.messages.scrollTop = e.messages.scrollHeight;
}

function renderSelect(card: HTMLElement, req: any, reply: (r: UiResponse) => void, cancel: () => void): void {
	const rawOpts: string[] = Array.isArray(req.options) ? req.options : [];
	// Pi extensions (e.g. ask_user) append "Other (type your own)" for TUI
	// clients without inline text input. We render an inline textarea below,
	// so hide that option to avoid duplication. Same for the "✓ Done" sentinel
	// the Pi side adds for multi-select TUI loops — we submit all picks at
	// once via a real checkbox group instead.
	const opts = rawOpts.filter(
		(o) => !/Other \(type your own\)/i.test(o) && !/✓\s*Done/i.test(o),
	);

	// Multi-select detection: Pi side prefixes the title with
	// "(multi-select)" for ask_user questions where multiple options
	// can be picked. Render checkboxes + a submit button.
	const isMulti = typeof req.title === "string" && /\(multi-select\)/.test(req.title);

	if (isMulti) {
		const list = document.createElement("div");
		list.className = "question-options question-options-multi";
		const checks: HTMLInputElement[] = [];
		opts.forEach((opt: string) => {
			const label = document.createElement("label");
			label.className = "question-option question-option-multi";
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.value = opt;
			label.appendChild(cb);
			const txt = document.createElement("span");
			txt.textContent = opt;
			label.appendChild(txt);
			list.appendChild(label);
			checks.push(cb);
		});
		card.appendChild(list);

		// Optional inline free-text — added to the selection on submit if
		// the textarea has content.
		const customLabel = document.createElement("div");
		customLabel.className = "question-message";
		customLabel.textContent = t("chat.modal.customLabelOptional");
		card.appendChild(customLabel);
		const customInput = document.createElement("textarea");
		customInput.rows = 2;
		customInput.className = "question-input";
		customInput.placeholder = t("chat.modal.customPlaceholderOptional");
		card.appendChild(customInput);

		const row = document.createElement("div");
		row.className = "question-row";
		const submit = document.createElement("button");
		submit.className = "primary";
		submit.textContent = t("chat.modal.submitMulti");
		const doSubmit = () => {
			const picked = checks.filter((c) => c.checked).map((c) => stripNumbering(c.value));
			const extra = customInput.value.trim();
			if (extra) picked.push(extra);
			if (picked.length === 0) return;
			reply({ type: "extension_ui_response", id: req.id, value: picked.join(", ") });
		};
		submit.addEventListener("click", doSubmit);
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "ghost";
		cancelBtn.textContent = t("chat.modal.cancel");
		cancelBtn.addEventListener("click", cancel);
		row.appendChild(submit);
		row.appendChild(cancelBtn);
		card.appendChild(row);
		return;
	}

	// Single-select (default) path
	const list = document.createElement("div");
	list.className = "question-options";
	opts.forEach((opt: string) => {
		const btn = document.createElement("button");
		btn.className = "question-option";
		btn.textContent = opt;
		btn.addEventListener("click", () =>
			reply({ type: "extension_ui_response", id: req.id, value: opt }),
		);
		list.appendChild(btn);
	});
	card.appendChild(list);

	// Inline free-text channel — ask_user treats any non-matching string as "Other".
	const customLabel = document.createElement("div");
	customLabel.className = "question-message";
	customLabel.textContent = t("chat.modal.customLabel");
	card.appendChild(customLabel);
	const customInput = document.createElement("textarea");
	customInput.rows = 2;
	customInput.className = "question-input";
	customInput.placeholder = t("chat.modal.customPlaceholder");
	card.appendChild(customInput);
	const customRow = document.createElement("div");
	customRow.className = "question-row";
	const sendCustom = document.createElement("button");
	sendCustom.className = "primary";
	sendCustom.textContent = t("chat.modal.send");
	const submitCustom = () => {
		const v = customInput.value.trim();
		if (!v) return;
		reply({ type: "extension_ui_response", id: req.id, value: v });
	};
	sendCustom.addEventListener("click", submitCustom);
	customInput.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submitCustom();
		}
	});
	const cancelBtn = document.createElement("button");
	cancelBtn.className = "ghost";
	cancelBtn.textContent = t("chat.modal.cancel");
	cancelBtn.addEventListener("click", cancel);
	customRow.appendChild(sendCustom);
	customRow.appendChild(cancelBtn);
	card.appendChild(customRow);
}

/** Strip the leading "N. " numbering Pi adds to options (and the " — desc"
 *  description tail) so we send back just the canonical label that Pi's
 *  ask_user parsing expects. */
function stripNumbering(s: string): string {
	return s.replace(/^\d+\.\s+/, "").split(" — ")[0];
}

function renderConfirm(card: HTMLElement, req: any, reply: (r: UiResponse) => void): void {
	if (req.message) {
		const m = document.createElement("div");
		m.className = "question-message";
		m.textContent = String(req.message);
		card.appendChild(m);
	}
	const row = document.createElement("div");
	row.className = "question-row";
	const yes = document.createElement("button");
	yes.className = "primary";
	yes.textContent = t("chat.modal.yes");
	yes.addEventListener("click", () =>
		reply({ type: "extension_ui_response", id: req.id, confirmed: true }),
	);
	const no = document.createElement("button");
	no.className = "ghost";
	no.textContent = t("chat.modal.no");
	no.addEventListener("click", () =>
		reply({ type: "extension_ui_response", id: req.id, confirmed: false }),
	);
	row.appendChild(yes);
	row.appendChild(no);
	card.appendChild(row);
}

function renderInputOrEditor(
	card: HTMLElement,
	req: any,
	reply: (r: UiResponse) => void,
	cancel: () => void,
): void {
	const tag = req.method === "editor" ? "textarea" : "input";
	const ta = document.createElement(tag) as HTMLTextAreaElement | HTMLInputElement;
	if (req.method === "editor" && req.prefill) ta.value = String(req.prefill);
	else if (req.method === "input" && req.placeholder)
		(ta as HTMLInputElement).placeholder = String(req.placeholder);
	(ta as any).rows = 4;
	ta.className = "question-input";
	card.appendChild(ta);
	const row = document.createElement("div");
	row.className = "question-row";
	const ok = document.createElement("button");
	ok.className = "primary";
	ok.textContent = t("chat.modal.send");
	const submit = () => reply({ type: "extension_ui_response", id: req.id, value: ta.value });
	ok.addEventListener("click", submit);
	(ta as HTMLElement).addEventListener("keydown", ((e: KeyboardEvent) => {
		if (e.key === "Enter" && (req.method === "input" || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			submit();
		}
	}) as EventListener);
	const cancelBtn = document.createElement("button");
	cancelBtn.className = "ghost";
	cancelBtn.textContent = t("chat.modal.cancel");
	cancelBtn.addEventListener("click", cancel);
	row.appendChild(ok);
	row.appendChild(cancelBtn);
	card.appendChild(row);
	setTimeout(() => ta.focus(), 0);
}

// ── Inline replacement dialogs (window.prompt/confirm are blocked in webviews) ─

export function showConfirmDialog(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const modalRoot = els().modalRoot;
		const backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		const modal = document.createElement("div");
		modal.className = "modal";
		const msg = document.createElement("div");
		msg.className = "modal-prompt";
		msg.textContent = message;
		modal.appendChild(msg);
		const row = document.createElement("div");
		row.className = "modal-row";
		const yes = document.createElement("button");
		yes.className = "primary";
		yes.textContent = t("chat.modal.yes");
		yes.addEventListener("click", () => {
			modalRoot.innerHTML = "";
			resolve(true);
		});
		const no = document.createElement("button");
		no.className = "ghost";
		no.textContent = t("chat.modal.no");
		no.addEventListener("click", () => {
			modalRoot.innerHTML = "";
			resolve(false);
		});
		row.append(yes, no);
		modal.appendChild(row);
		backdrop.appendChild(modal);
		modalRoot.innerHTML = "";
		modalRoot.appendChild(backdrop);
	});
}

export function showInputDialog(message: string, initial = ""): Promise<string | null> {
	return new Promise((resolve) => {
		const modalRoot = els().modalRoot;
		const backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		const modal = document.createElement("div");
		modal.className = "modal";
		const msg = document.createElement("div");
		msg.className = "modal-prompt";
		msg.textContent = message;
		modal.appendChild(msg);
		const input = document.createElement("input");
		input.className = "modal-input";
		input.value = initial;
		modal.appendChild(input);
		const row = document.createElement("div");
		row.className = "modal-row";
		const ok = document.createElement("button");
		ok.className = "primary";
		ok.textContent = t("chat.modal.ok");
		const submit = () => {
			modalRoot.innerHTML = "";
			resolve(input.value);
		};
		ok.addEventListener("click", submit);
		const cancel = document.createElement("button");
		cancel.className = "ghost";
		cancel.textContent = t("chat.modal.cancel");
		cancel.addEventListener("click", () => {
			modalRoot.innerHTML = "";
			resolve(null);
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		});
		row.append(ok, cancel);
		modal.appendChild(row);
		backdrop.appendChild(modal);
		modalRoot.innerHTML = "";
		modalRoot.appendChild(backdrop);
		setTimeout(() => input.focus(), 0);
	});
}

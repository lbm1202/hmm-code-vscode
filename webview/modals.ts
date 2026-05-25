// Inline question cards for select/confirm/input/editor + native-replacement
// confirm/input modal dialogs. Question cards render in the messages area as
// part of the conversation; the dialogs use a backdrop overlay.

import { appendBubble, els, setEmptyVisibility } from "./dom";
import { safeStringify } from "./helpers";
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
		// User answered → likely a new turn begins; reset the in-bubble status row.
		ensureTurn();
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
		okBtn.textContent = "닫기";
		okBtn.addEventListener("click", cancel);
		card.appendChild(okBtn);
	}

	const e = els();
	e.messages.appendChild(card);
	setEmptyVisibility();
	e.messages.scrollTop = e.messages.scrollHeight;
}

function renderSelect(card: HTMLElement, req: any, reply: (r: UiResponse) => void, cancel: () => void): void {
	const list = document.createElement("div");
	list.className = "question-options";
	const rawOpts: string[] = Array.isArray(req.options) ? req.options : [];
	// Pi extensions (e.g. ask_user) append "Other (type your own)" for TUI
	// clients without inline text input. We render an inline textarea below,
	// so hide that option to avoid duplication.
	const opts = rawOpts.filter((o) => !/Other \(type your own\)/i.test(o));
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
	customLabel.textContent = "또는 직접 입력:";
	card.appendChild(customLabel);
	const customInput = document.createElement("textarea");
	customInput.rows = 2;
	customInput.className = "question-input";
	customInput.placeholder = "자유롭게 답을 적고 Enter 또는 '전송'…";
	card.appendChild(customInput);
	const customRow = document.createElement("div");
	customRow.className = "question-row";
	const sendCustom = document.createElement("button");
	sendCustom.className = "primary";
	sendCustom.textContent = "전송";
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
	cancelBtn.textContent = "취소";
	cancelBtn.addEventListener("click", cancel);
	customRow.appendChild(sendCustom);
	customRow.appendChild(cancelBtn);
	card.appendChild(customRow);
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
	yes.textContent = "예";
	yes.addEventListener("click", () =>
		reply({ type: "extension_ui_response", id: req.id, confirmed: true }),
	);
	const no = document.createElement("button");
	no.className = "ghost";
	no.textContent = "아니오";
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
	ok.textContent = "전송";
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
	cancelBtn.textContent = "취소";
	cancelBtn.addEventListener("click", cancel);
	row.appendChild(ok);
	row.appendChild(cancelBtn);
	card.appendChild(row);
	setTimeout(() => ta.focus(), 0);
	void appendBubble; // satisfy import (kept for future use)
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
		yes.textContent = "예";
		yes.addEventListener("click", () => {
			modalRoot.innerHTML = "";
			resolve(true);
		});
		const no = document.createElement("button");
		no.className = "ghost";
		no.textContent = "아니오";
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
		ok.textContent = "확인";
		const submit = () => {
			modalRoot.innerHTML = "";
			resolve(input.value);
		};
		ok.addEventListener("click", submit);
		const cancel = document.createElement("button");
		cancel.className = "ghost";
		cancel.textContent = "취소";
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

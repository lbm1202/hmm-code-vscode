// Sidebar session-list webview. Standalone bundle (no chat modules) — it only
// lists the current workspace's sessions and asks the host to open one in an
// editor panel. Host side: src/sessions-view.ts.
//
// Deliberately does NOT import ./state or ./dom: those belong to the chat page
// (state.ts calls acquireVsCodeApi at import time, dom.ts builds the chat DOM).
// This page acquires its own API handle and owns its own small DOM.

import { t } from "./i18n";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

interface SessionEntry {
	file: string;
	name: string;
	mtimeMs: number;
	parentFile?: string;
}

let sessions: SessionEntry[] = [];
let openFiles = new Set<string>();
let noAuth = false;
let query = "";
const collapsed = new Set<string>();
let usageToken = 0;

function post(msg: unknown): void {
	vscode.postMessage(msg);
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "Just now / 5m / 3h / 12d", falling back to a plain date past a week. Mirrors
 *  how VS Code's own lists age their entries. */
function relativeTime(ms: number): string {
	const diff = Date.now() - ms;
	if (!Number.isFinite(diff)) return "";
	const min = Math.floor(diff / 60000);
	if (min < 1) return t("sessions.ago.now");
	if (min < 60) return t("sessions.ago.min", { n: min });
	const hour = Math.floor(min / 60);
	if (hour < 24) return t("sessions.ago.hour", { n: hour });
	const day = Math.floor(hour / 24);
	if (day <= 7) return t("sessions.ago.day", { n: day });
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Session files are named `<ISO timestamp>_<uuid>.jsonl`; an unnamed session
 *  falls back to that filename, which is noise in a list. Show the timestamp
 *  part only. */
function displayName(s: SessionEntry): string {
	const m = s.name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s.name;
}

// ── Small modal helpers (input / confirm). Reuse the chat's modal CSS. ────────

function modalRoot(): HTMLElement {
	return document.getElementById("sx-modal-root")!;
}

function showInput(prompt: string, initial: string): Promise<string | null> {
	return new Promise((resolve) => {
		const root = modalRoot();
		root.innerHTML = "";
		const backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		const modal = document.createElement("div");
		modal.className = "modal";
		const label = document.createElement("div");
		label.className = "modal-prompt";
		label.textContent = prompt;
		const input = document.createElement("input");
		input.type = "text";
		input.className = "modal-input";
		input.value = initial;
		const row = document.createElement("div");
		row.className = "modal-row";
		const ok = document.createElement("button");
		ok.textContent = t("sessions.save");
		const cancel = document.createElement("button");
		cancel.className = "secondary";
		cancel.textContent = t("sessions.cancel");
		const done = (val: string | null) => {
			root.innerHTML = "";
			resolve(val);
		};
		ok.addEventListener("click", () => done(input.value));
		cancel.addEventListener("click", () => done(null));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") done(input.value);
			if (e.key === "Escape") done(null);
		});
		row.append(ok, cancel);
		modal.append(label, input, row);
		backdrop.appendChild(modal);
		root.appendChild(backdrop);
		input.focus();
		input.select();
	});
}

function showConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const root = modalRoot();
		root.innerHTML = "";
		const backdrop = document.createElement("div");
		backdrop.className = "modal-backdrop";
		const modal = document.createElement("div");
		modal.className = "modal";
		const label = document.createElement("div");
		label.className = "modal-prompt";
		label.style.whiteSpace = "pre-wrap";
		label.textContent = message;
		const row = document.createElement("div");
		row.className = "modal-row";
		const ok = document.createElement("button");
		ok.className = "danger";
		ok.textContent = t("sessions.delete");
		const cancel = document.createElement("button");
		cancel.className = "secondary";
		cancel.textContent = t("sessions.cancel");
		const done = (val: boolean) => {
			root.innerHTML = "";
			resolve(val);
		};
		ok.addEventListener("click", () => done(true));
		cancel.addEventListener("click", () => done(false));
		row.append(ok, cancel);
		modal.append(label, row);
		backdrop.appendChild(modal);
		root.appendChild(backdrop);
		ok.focus();
	});
}

// ── Usage modal (topbar ％) ──────────────────────────────────────────────────

function gauge(label: string, pct: number, right: string): HTMLElement {
	const p = Math.max(0, Math.min(100, Math.round(pct)));
	const wrap = document.createElement("div");
	wrap.className = "ctx-gauge";
	const lab = document.createElement("div");
	lab.className = "ctx-gauge-label";
	const left = document.createElement("span");
	left.textContent = label;
	const rightEl = document.createElement("span");
	rightEl.className = "ctx-gauge-nums";
	rightEl.textContent = right ? `${p}% · ${right}` : `${p}%`;
	lab.append(left, rightEl);
	const track = document.createElement("div");
	track.className = "ctx-gauge-track";
	const fill = document.createElement("div");
	fill.className = "ctx-gauge-fill";
	fill.classList.add(p >= 90 ? "danger" : p >= 70 ? "warn" : "ok");
	fill.style.width = `${p}%`;
	track.appendChild(fill);
	wrap.append(lab, track);
	return wrap;
}

function note(text: string): HTMLElement {
	const div = document.createElement("div");
	div.className = "modal-context";
	div.textContent = text;
	return div;
}

function head(text: string): HTMLElement {
	const div = document.createElement("div");
	div.className = "sub-usage-head";
	div.textContent = text;
	return div;
}

function resetLabel(epoch: number): string {
	if (!epoch) return "";
	const when = new Date(epoch * 1000).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return t("settings.usage.resetsAt", { when });
}

let usageBody: HTMLElement | null = null;

function openUsageModal(): void {
	const root = modalRoot();
	root.innerHTML = "";
	usageToken++;
	const backdrop = document.createElement("div");
	backdrop.className = "modal-backdrop";
	const modal = document.createElement("div");
	modal.className = "modal sub-usage-modal";
	const title = document.createElement("div");
	title.className = "modal-prompt";
	title.textContent = t("chat.usage.title");
	const body = document.createElement("div");
	body.className = "sub-usage-body";
	body.appendChild(note(t("settings.usage.checking")));
	usageBody = body;
	const row = document.createElement("div");
	row.className = "modal-row";
	const close = document.createElement("button");
	close.className = "ghost";
	close.textContent = t("settings.close");
	const dismiss = () => {
		usageBody = null;
		root.innerHTML = "";
	};
	close.addEventListener("click", dismiss);
	backdrop.addEventListener("click", (e) => {
		if (e.target === backdrop) dismiss();
	});
	row.appendChild(close);
	modal.append(title, body, row);
	backdrop.appendChild(modal);
	root.appendChild(backdrop);
	post({ kind: "usage", token: usageToken });
}

function renderUsage(msg: any): void {
	const body = usageBody;
	if (!body || Number(msg?.token) !== usageToken) return;
	body.innerHTML = "";
	const entries: any[] = Array.isArray(msg?.entries) ? msg.entries : [];
	if (!entries.length) {
		body.appendChild(note(t("chat.usage.none")));
		return;
	}
	for (const e of entries) {
		if (e.provider === "anthropic") {
			body.appendChild(head(t("chat.usage.claude")));
			if (e.error || !e.usage) {
				body.appendChild(note(`${t("settings.usage.failed")}${e.error ? " — " + e.error : ""}`));
				continue;
			}
			for (const w of e.usage.windows ?? []) {
				const label = w.kind === "session" ? t("settings.usage.5h") : t("settings.usage.weekly");
				body.appendChild(gauge(label, Number(w.usedPercent) || 0, resetLabel(Number(w.resetAt) || 0)));
			}
		} else if (e.provider === "openai-codex") {
			const plan = e.codex?.planType ? ` · ${t("settings.usage.plan", { plan: e.codex.planType })}` : "";
			body.appendChild(head(t("chat.usage.codex") + plan));
			if (e.error || !e.codex) {
				body.appendChild(note(`${t("settings.usage.failed")}${e.error ? " — " + e.error : ""}`));
				continue;
			}
			for (const w of [e.codex.primary, e.codex.secondary]) {
				if (!w) continue;
				const secs = Number(w.windowSeconds) || 0;
				const label =
					secs === 18000
						? t("settings.usage.5h")
						: secs === 604800
							? t("settings.usage.weekly")
							: `${Math.round(secs / 3600)}h`;
				body.appendChild(gauge(label, Number(w.usedPercent) || 0, resetLabel(Number(w.resetAt) || 0)));
			}
		}
	}
}

// ── List rendering ───────────────────────────────────────────────────────────

/** Group children under parents (case-folded: macOS/Windows preserve path case
 *  but fold it on disk, so a parent pointer can differ in case from the file). */
function buildTree(list: SessionEntry[]): {
	roots: SessionEntry[];
	childrenOf: Map<string, SessionEntry[]>;
} {
	const lowerToFile = new Map<string, string>();
	for (const s of list) lowerToFile.set(s.file.toLowerCase(), s.file);
	const childrenOf = new Map<string, SessionEntry[]>();
	const roots: SessionEntry[] = [];
	for (const s of list) {
		const parent = s.parentFile ? lowerToFile.get(s.parentFile.toLowerCase()) : undefined;
		if (parent) {
			const arr = childrenOf.get(parent) ?? [];
			arr.push(s);
			childrenOf.set(parent, arr);
		} else {
			roots.push(s);
		}
	}
	const byNewest = (a: SessionEntry, b: SessionEntry) => b.mtimeMs - a.mtimeMs;
	roots.sort(byNewest);
	for (const arr of childrenOf.values()) arr.sort(byNewest);
	return { roots, childrenOf };
}

function countDescendants(file: string, childrenOf: Map<string, SessionEntry[]>): number {
	let n = 0;
	const queue = [file];
	while (queue.length) {
		const f = queue.shift()!;
		for (const k of childrenOf.get(f) ?? []) {
			n++;
			queue.push(k.file);
		}
	}
	return n;
}

function isOpen(file: string): boolean {
	return openFiles.has(file.toLowerCase());
}

function buildRow(
	s: SessionEntry,
	depth: number,
	childrenOf: Map<string, SessionEntry[]>,
	flat: boolean,
): HTMLElement {
	const kids = childrenOf.get(s.file) ?? [];
	const hasKids = !flat && kids.length > 0;
	const expanded = hasKids && !collapsed.has(s.file);

	const row = document.createElement("div");
	row.className = "sx-row";
	if (isOpen(s.file)) row.classList.add("open");
	row.style.paddingLeft = `${depth * 12}px`;

	const caret = document.createElement("button");
	caret.className = "sx-caret";
	caret.textContent = hasKids ? (expanded ? "▾" : "▸") : "";
	caret.disabled = !hasKids;
	caret.addEventListener("click", (e) => {
		e.stopPropagation();
		if (!hasKids) return;
		if (expanded) collapsed.add(s.file);
		else collapsed.delete(s.file);
		render();
	});
	row.appendChild(caret);

	const item = document.createElement("button");
	item.className = "sx-item";
	item.title = t("sessions.openTitle");
	const label = displayName(s);
	const descendants = kids.length ? countDescendants(s.file, childrenOf) : 0;
	item.innerHTML =
		`<span class="sx-name">${escapeHtml(label)}</span>` +
		`<span class="sx-meta">${escapeHtml(relativeTime(s.mtimeMs))}` +
		(descendants ? ` · <span class="sx-kids">${descendants}</span>` : "") +
		`</span>`;
	item.addEventListener("click", () => post({ kind: "open", file: s.file }));
	row.appendChild(item);

	const actions = document.createElement("div");
	actions.className = "sx-actions-row";

	const renameBtn = document.createElement("button");
	renameBtn.className = "sx-iconbtn";
	renameBtn.textContent = "✎";
	renameBtn.title = t("chat.sessions.renameTitle");
	renameBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		const next = await showInput(t("chat.sessions.renamePrompt"), s.name);
		if (next == null) return;
		post({ kind: "rename", file: s.file, name: next });
	});
	actions.appendChild(renameBtn);

	const delBtn = document.createElement("button");
	delBtn.className = "sx-iconbtn danger";
	delBtn.textContent = "🗑";
	delBtn.title = descendants
		? t("chat.sessions.deleteWithChildren", { n: descendants })
		: t("chat.sessions.delete");
	delBtn.addEventListener("click", async (e) => {
		e.stopPropagation();
		const msg = descendants
			? t("chat.sessions.confirmDeleteWithChildren", { label, n: descendants })
			: t("chat.sessions.confirmDelete", { label });
		if (!(await showConfirm(msg))) return;
		post({ kind: "delete", file: s.file });
	});
	actions.appendChild(delBtn);
	row.appendChild(actions);

	return row;
}

function render(): void {
	const list = document.getElementById("sx-list")!;
	list.innerHTML = "";

	// No auth anywhere: the full onboarding card (with the login flows) lives in
	// the chat page, so point there rather than duplicating it here.
	if (noAuth) {
		const hint = document.createElement("div");
		hint.className = "sx-empty";
		hint.textContent = t("sessions.noAuth");
		const cta = document.createElement("button");
		cta.className = "sx-newbtn";
		cta.style.marginTop = "8px";
		cta.textContent = t("sessions.noAuthCta");
		cta.addEventListener("click", () => post({ kind: "new" }));
		hint.appendChild(cta);
		list.appendChild(hint);
	}

	const q = query.trim().toLowerCase();
	const filtered = q ? sessions.filter((s) => s.name.toLowerCase().includes(q)) : sessions;

	if (!sessions.length) {
		const empty = document.createElement("div");
		empty.className = "sx-empty";
		empty.textContent = t("chat.noSessions");
		list.appendChild(empty);
		return;
	}
	if (!filtered.length) {
		const empty = document.createElement("div");
		empty.className = "sx-empty";
		empty.textContent = t("sessions.noMatch");
		list.appendChild(empty);
		return;
	}

	// While searching, show a flat result list — a tree would hide matches whose
	// parent didn't match.
	if (q) {
		const { childrenOf } = buildTree(sessions);
		for (const s of filtered) list.appendChild(buildRow(s, 0, childrenOf, true));
		return;
	}

	const { roots, childrenOf } = buildTree(sessions);
	const renderNode = (s: SessionEntry, depth: number): void => {
		list.appendChild(buildRow(s, depth, childrenOf, false));
		if (collapsed.has(s.file)) return;
		for (const k of childrenOf.get(s.file) ?? []) renderNode(k, depth + 1);
	};
	for (const r of roots) renderNode(r, 0);
}

function boot(): void {
	const app = document.getElementById("app")!;
	app.innerHTML = `
	<div class="sx-root">
		<div class="sx-topbar">
			<button class="sx-newbtn" id="sx-new">＋ ${escapeHtml(t("sessions.new"))}</button>
			<div class="sx-topactions">
				<button class="iconbtn" id="sx-usage" title="${escapeHtml(t("chat.usage.title"))}">％</button>
				<button class="iconbtn" id="sx-settings" title="${escapeHtml(t("sessions.settings"))}">⚙︎</button>
			</div>
		</div>
		<div class="sx-searchrow">
			<input type="text" id="sx-q" class="sx-search" placeholder="${escapeHtml(t("sessions.search"))}" />
		</div>
		<div class="sx-list" id="sx-list"></div>
		<div id="sx-modal-root"></div>
	</div>`;

	document.getElementById("sx-new")!.addEventListener("click", () => post({ kind: "new" }));
	document.getElementById("sx-settings")!.addEventListener("click", () => post({ kind: "settings" }));
	document.getElementById("sx-usage")!.addEventListener("click", () => openUsageModal());
	const input = document.getElementById("sx-q") as HTMLInputElement;
	input.addEventListener("input", () => {
		query = input.value;
		render();
	});

	window.addEventListener("message", (ev) => {
		const msg = ev.data;
		if (msg?.kind === "sessions") {
			sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
			openFiles = new Set(
				(Array.isArray(msg.open) ? msg.open : []).map((f: string) => f.toLowerCase()),
			);
			noAuth = msg.noAuth === true;
			render();
		} else if (msg?.kind === "usage") {
			renderUsage(msg);
		}
	});

	post({ kind: "list" });
}

boot();

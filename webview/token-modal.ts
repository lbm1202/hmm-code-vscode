// Token-usage modal, opened by clicking the ctx-pill in the footer. Shows
// per-model input/output totals for the current session AND every session it
// spawned (parent includes children) — the host aggregates the subtree.

import { els } from "./dom";

/** 1234 → "1.2k", 1_600_000 → "1.6M", < 1000 → as-is. */
function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return String(n);
}

export function showTokenModal(
	perModel: Record<string, { input: number; output: number }>,
	sessionCount: number,
	context?: { tokens: number; contextWindow: number; percent: number },
): void {
	const modalRoot = els().modalRoot;

	const backdrop = document.createElement("div");
	backdrop.className = "modal-backdrop";
	const modal = document.createElement("div");
	modal.className = "modal token-modal";

	const title = document.createElement("div");
	title.className = "modal-prompt";
	title.textContent = "Token usage";
	modal.appendChild(title);

	const sub = document.createElement("div");
	sub.className = "modal-context";
	const children = sessionCount - 1;
	sub.textContent =
		children > 0
			? `This session + ${children} child session${children === 1 ? "" : "s"}`
			: "This session";
	modal.appendChild(sub);

	// Context-window gauge for the CURRENT model (tokens / window + % fill).
	if (context && context.contextWindow > 0) {
		const pct = Math.max(0, Math.min(100, context.percent));
		const gauge = document.createElement("div");
		gauge.className = "ctx-gauge";
		const label = document.createElement("div");
		label.className = "ctx-gauge-label";
		const left = document.createElement("span");
		left.textContent = "Context";
		const right = document.createElement("span");
		right.className = "ctx-gauge-nums";
		right.textContent = `${fmt(context.tokens)} / ${fmt(context.contextWindow)} · ${pct.toFixed(1)}%`;
		label.append(left, right);
		const track = document.createElement("div");
		track.className = "ctx-gauge-track";
		const fill = document.createElement("div");
		fill.className = "ctx-gauge-fill";
		// Warn as the window fills: amber past 70% (auto-compact zone), red past 90%.
		fill.classList.add(pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");
		fill.style.width = `${pct}%`;
		track.appendChild(fill);
		gauge.append(label, track);
		modal.appendChild(gauge);
	}

	const models = Object.entries(perModel).sort(
		(a, b) => b[1].input + b[1].output - (a[1].input + a[1].output),
	);

	if (models.length === 0) {
		const empty = document.createElement("div");
		empty.className = "modal-context";
		empty.textContent = "No token usage recorded yet.";
		modal.appendChild(empty);
	} else {
		const table = document.createElement("table");
		table.className = "token-table";
		table.innerHTML =
			"<thead><tr><th>Model</th><th>↓ in</th><th>↑ out</th></tr></thead>";
		const tbody = document.createElement("tbody");
		let tin = 0;
		let tout = 0;
		for (const [model, u] of models) {
			tin += u.input;
			tout += u.output;
			const tr = document.createElement("tr");
			const name = document.createElement("td");
			name.className = "token-model";
			name.textContent = model;
			const inC = document.createElement("td");
			inC.className = "token-num";
			inC.textContent = fmt(u.input);
			const outC = document.createElement("td");
			outC.className = "token-num";
			outC.textContent = fmt(u.output);
			tr.append(name, inC, outC);
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		// Total row only when more than one model contributed.
		if (models.length > 1) {
			const foot = document.createElement("tr");
			foot.className = "token-total";
			foot.innerHTML = `<td>Total</td><td class="token-num">${fmt(tin)}</td><td class="token-num">${fmt(tout)}</td>`;
			tbody.appendChild(foot);
		}
		modal.appendChild(table);
	}

	const row = document.createElement("div");
	row.className = "modal-row";
	const close = document.createElement("button");
	close.className = "ghost";
	close.textContent = "Close";
	const dismiss = () => {
		modalRoot.innerHTML = "";
		document.removeEventListener("keydown", onKey, true);
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			dismiss();
		}
	};
	close.addEventListener("click", dismiss);
	backdrop.addEventListener("click", (e) => {
		if (e.target === backdrop) dismiss();
	});
	document.addEventListener("keydown", onKey, true);
	row.appendChild(close);
	modal.appendChild(row);

	backdrop.appendChild(modal);
	modalRoot.innerHTML = "";
	modalRoot.appendChild(backdrop);
}

// Session resume modal: parent-child tree with expand/collapse, rename, delete.

import { els } from "./dom";
import { escapeHtml } from "./helpers";
import { t } from "./i18n";
import { showConfirmDialog, showInputDialog } from "./modals";
import { FROM_WEBVIEW } from "./protocol";
import { expandedSessions, post, ui } from "./state";
import type { SessionEntry } from "./types";

function sessionLabel(s: SessionEntry): string {
	const m = s.name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
	return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : s.name;
}

function countDescendants(file: string, byParent: Map<string, SessionEntry[]>): number {
	let count = 0;
	const queue = [file];
	while (queue.length > 0) {
		const f = queue.shift()!;
		const kids = byParent.get(f) ?? [];
		count += kids.length;
		for (const k of kids) queue.push(k.file);
	}
	return count;
}

export function showSessionPicker(
	sessions: SessionEntry[],
	opts: { loading?: boolean } = {},
): void {
	const modalRoot = els().modalRoot;
	modalRoot.innerHTML = "";
	const backdrop = document.createElement("div");
	backdrop.className = "modal-backdrop";
	const modal = document.createElement("div");
	// `session-picker` is a stable marker so dispatch can re-render this modal
	// in place when a fresh SESSIONS list arrives — even while it's showing the
	// loading state (no `.session-tree` yet) or the empty state.
	modal.className = "modal modal-wide session-picker";
	// Show the loading state only when there's nothing cached to display yet —
	// if we already have sessions, render them instantly and let the SESSIONS
	// response refresh them in place (no loading flash for the common case).
	const loading = !!opts.loading && sessions.length === 0;
	const title = document.createElement("div");
	title.className = "modal-prompt";
	title.textContent = loading
		? t("chat.sessions.loading")
		: sessions.length
			? t("chat.sessions.title")
			: t("chat.noSessions");
	modal.appendChild(title);

	if (loading) {
		const spinner = document.createElement("div");
		spinner.className = "session-loading";
		modal.appendChild(spinner);
	} else if (sessions.length) {
		const childrenByParent = new Map<string, SessionEntry[]>();
		const roots: SessionEntry[] = [];
		// macOS + Windows filesystems are case-insensitive, but path strings
		// preserve the case they were created with. VS Code's workspace cwd
		// and Pi's stored `parentSession` can differ in case (e.g. `dev` vs
		// `Dev`) for the same on-disk directory — exact equality misses, all
		// children fall to roots, tree collapses to a flat list. Compare
		// lowercased copies and map back to the canonical file for grouping.
		const lowerToFile = new Map<string, string>();
		for (const s of sessions) lowerToFile.set(s.file.toLowerCase(), s.file);
		for (const s of sessions) {
			const parentCanonical = s.parentFile
				? lowerToFile.get(s.parentFile.toLowerCase())
				: undefined;
			if (parentCanonical) {
				const list = childrenByParent.get(parentCanonical) ?? [];
				list.push(s);
				childrenByParent.set(parentCanonical, list);
			} else {
				roots.push(s);
			}
		}
		const byMtimeDesc = (a: SessionEntry, b: SessionEntry) => b.mtimeMs - a.mtimeMs;
		roots.sort(byMtimeDesc);
		for (const list of childrenByParent.values()) list.sort(byMtimeDesc);

		const list = document.createElement("div");
		list.className = "modal-options session-tree";

		const renderNode = (s: SessionEntry, depth: number) => {
			const row = document.createElement("div");
			row.className = "session-row";
			row.style.paddingLeft = `${depth * 16}px`;

			const kids = childrenByParent.get(s.file) ?? [];
			const hasKids = kids.length > 0;
			const expanded = expandedSessions.has(s.file);

			const caret = document.createElement("button");
			caret.className = "session-caret";
			caret.textContent = hasKids ? (expanded ? "▾" : "▸") : "·";
			caret.disabled = !hasKids;
			caret.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!hasKids) return;
				if (expanded) expandedSessions.delete(s.file);
				else expandedSessions.add(s.file);
				showSessionPicker(ui.sessions);
			});
			row.appendChild(caret);

			const titleBtn = document.createElement("button");
			titleBtn.className = "session-item session-item-title";
			const label = sessionLabel(s);
			const idShort = s.name.split("_")[1]?.slice(0, 6) ?? "";
			// Badge counts ALL descendants (children + grandchildren + …), not
			// just direct children — matches the delete-cascade count.
			const descendants = hasKids ? countDescendants(s.file, childrenByParent) : 0;
			const kidCount = descendants > 0 ? `<span class="session-kid-count">(${descendants})</span>` : "";
			// Title-bar layout: title on the left, then kid count, then id. We
			// keep them in flow order (no space-between) so spacing stays even
			// regardless of row width. ID truncates first when space is tight.
			titleBtn.innerHTML =
				`<span class="session-time">${escapeHtml(label)}</span>` +
				kidCount +
				`<span class="session-id">${escapeHtml(idShort)}</span>`;
			// Click on title = toggle expand (NOT switch). User must press the Go button to switch.
			titleBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!hasKids) return;
				if (expanded) expandedSessions.delete(s.file);
				else expandedSessions.add(s.file);
				showSessionPicker(ui.sessions);
			});
			row.appendChild(titleBtn);

			// Actions wrapper so the action buttons stay together as a unit
			// when the row wraps in narrow widths (sidebar < ~360px).
			const actions = document.createElement("div");
			actions.className = "session-actions";
			row.appendChild(actions);

			const goBtn = document.createElement("button");
			goBtn.className = "session-iconbtn primary";
			goBtn.textContent = t("chat.sessions.go");
			goBtn.title = t("chat.sessions.goTitle");
			goBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				modalRoot.innerHTML = "";
				post({
					kind: FROM_WEBVIEW.COMMAND,
					command: { type: "switch_session", sessionPath: s.file },
				});
			});
			actions.appendChild(goBtn);

			const renameBtn = document.createElement("button");
			renameBtn.className = "session-iconbtn";
			renameBtn.textContent = "✎";
			renameBtn.title = t("chat.sessions.renameTitle");
			renameBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					const next = await showInputDialog(t("chat.sessions.renamePrompt"), s.name);
					if (next == null) return;
					post({ kind: FROM_WEBVIEW.RENAME_SESSION, file: s.file, name: next });
				} catch (err) {
					console.error("[hmm-code:session-picker] rename failed:", err);
				}
			});
			actions.appendChild(renameBtn);

			const delBtn = document.createElement("button");
			delBtn.className = "session-iconbtn danger";
			delBtn.textContent = "🗑";
			const descendantCount = countDescendants(s.file, childrenByParent);
			delBtn.title = descendantCount > 0
				? t("chat.sessions.deleteWithChildren", { n: descendantCount })
				: t("chat.sessions.delete");
			delBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					const msg = descendantCount > 0
						? t("chat.sessions.confirmDeleteWithChildren", { label, n: descendantCount })
						: t("chat.sessions.confirmDelete", { label });
					const ok = await showConfirmDialog(msg);
					if (!ok) return;
					post({ kind: FROM_WEBVIEW.DELETE_SESSION, file: s.file });
					// Keep the picker open: the host's refreshSessions() pushes an
					// updated SESSIONS list and the dispatch SESSIONS handler
					// re-renders this picker in place (it stays mounted, so you can
					// delete several in a row). If the deleted file was the active
					// session, the host spins up a new one (see chat-backend
					// DELETE_SESSION handler).
				} catch (err) {
					console.error("[hmm-code:session-picker] delete failed:", err);
				}
			});
			actions.appendChild(delBtn);

			list.appendChild(row);

			if (expanded && hasKids) {
				for (const child of kids) renderNode(child, depth + 1);
			}
		};

		for (const r of roots) renderNode(r, 0);
		modal.appendChild(list);
	}

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "secondary";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", () => (modalRoot.innerHTML = ""));
	modal.appendChild(cancelBtn);

	backdrop.appendChild(modal);
	modalRoot.appendChild(backdrop);
}


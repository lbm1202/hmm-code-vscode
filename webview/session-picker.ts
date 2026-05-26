// Session resume modal: parent-child tree with expand/collapse, rename, delete.

import { els } from "./dom";
import { escapeHtml } from "./helpers";
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

export function showSessionPicker(sessions: SessionEntry[]): void {
	const modalRoot = els().modalRoot;
	modalRoot.innerHTML = "";
	const backdrop = document.createElement("div");
	backdrop.className = "modal-backdrop";
	const modal = document.createElement("div");
	modal.className = "modal modal-wide";
	const title = document.createElement("div");
	title.className = "modal-prompt";
	title.textContent = sessions.length ? "세션 이어가기" : "이 워크스페이스의 저장된 세션이 없습니다";
	modal.appendChild(title);

	if (sessions.length) {
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
			const kidCount = hasKids ? `<span class="session-kid-count">(${kids.length})</span>` : "";
			// Title-bar layout: title on the left, then kid count, then id. We
			// keep them in flow order (no space-between) so spacing stays even
			// regardless of row width. ID truncates first when space is tight.
			titleBtn.innerHTML =
				`<span class="session-time">${escapeHtml(label)}</span>` +
				kidCount +
				`<span class="session-id">${escapeHtml(idShort)}</span>`;
			// Click on title = toggle expand (NOT switch). User must press "이동" to switch.
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
			goBtn.textContent = "이동";
			goBtn.title = "이 세션으로 전환";
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
			renameBtn.title = "이름 변경";
			renameBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					const next = await showInputDialog("세션 이름 (비우면 기본값으로 복귀):", s.name);
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
				? `세션 삭제 (하위 세션 ${descendantCount}개 함께 삭제)`
				: "세션 삭제";
			delBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					const msg = descendantCount > 0
						? `정말 삭제할까요?\n${label}\n하위 세션 ${descendantCount}개도 함께 삭제됩니다.`
						: `정말 삭제할까요?\n${label}`;
					const ok = await showConfirmDialog(msg);
					if (!ok) return;
					post({ kind: FROM_WEBVIEW.DELETE_SESSION, file: s.file });
					// Close the picker — list is stale either way and re-opening
					// shows the fresh state. If the deleted file was the active
					// session, the host spins up a new one for us (see
					// chat-backend DELETE_SESSION handler).
					modalRoot.innerHTML = "";
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

/** True iff the session picker modal is currently visible. */
export function isSessionPickerOpen(): boolean {
	return els().modalRoot.querySelector(".session-list, .session-tree") !== null;
}

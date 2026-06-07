// Pinned todo panel: when todoPanelEnabled, todo_write drives a task list
// pinned above the message list (always visible, collapsible). A "Done" button
// appears only when every task is completed; clicking it dismisses the panel
// until the next non-all-complete todo_write. The full list also stops
// rendering inline (see updateToolResult in tools.ts) — it lives here instead.
//
// Data arrives via the TODOS setStatus channel (dispatch.ts) and, on reload,
// is seeded from the last todo_write in the transcript (history.ts). All DOM is
// built from escaped strings (renderTodoListHtml) and click handling is
// delegated on the container, so it survives the innerHTML re-renders.

import { els, scrollToBottomIfPinned } from "./dom";
import { escapeHtml } from "./helpers";
import { t } from "./i18n";
import { runtime } from "./state";
import { renderTodoListHtml, todoProgressLabel } from "./tools";

function allCompleted(todos: any[]): boolean {
	return todos.length > 0 && todos.every((x) => x?.status === "completed");
}

function hide(): void {
	els().todoPanel.classList.add("hidden");
}

function render(todos: any[], allDone: boolean): void {
	const panel = els().todoPanel;
	const caret = runtime.todoCollapsed ? "▸" : "▾";
	const doneBtn = allDone
		? `<button class="todo-panel-done" type="button">${escapeHtml(t("chat.todoDone"))}</button>`
		: "";
	const body = runtime.todoCollapsed
		? ""
		: `<div class="todo-panel-body">${renderTodoListHtml(todos)}</div>`;
	panel.innerHTML =
		`<div class="todo-panel-header">` +
		`<span class="todo-panel-caret">${caret}</span>` +
		`<span class="todo-panel-title">${escapeHtml(todoProgressLabel(todos))}</span>` +
		doneBtn +
		`</div>` +
		body;
	panel.classList.remove("hidden");
	// A taller/shorter panel changes the message-list height; keep the latest
	// message visible if the user was pinned to the bottom.
	scrollToBottomIfPinned();
}

/** Drive the panel from a fresh todos list (dispatch TODOS + history seed). */
export function updateTodoPanel(todos: any[]): void {
	runtime.todos = Array.isArray(todos) ? todos : [];
	const list = runtime.todos;
	if (list.length === 0) {
		hide();
		return;
	}
	const allDone = allCompleted(list);
	// New incomplete work always re-shows a dismissed panel.
	if (!allDone) runtime.todoDismissed = false;
	if (allDone && runtime.todoDismissed) {
		hide();
		return;
	}
	render(list, allDone);
}

/** Reset on session change (clearConversation) so the panel doesn't bleed
 *  across sessions. */
export function resetTodoPanel(): void {
	runtime.todos = [];
	runtime.todoDismissed = false;
	runtime.todoCollapsed = false;
	hide();
}

/** Bind caret + Done handlers once (main.ts, after initDom). Delegated on the
 *  container so it survives render()'s innerHTML rewrites. */
export function wireTodoPanel(): void {
	els().todoPanel.addEventListener("click", (ev) => {
		const target = ev.target as HTMLElement | null;
		// Done (all-complete) → dismiss until the next non-all-complete update.
		if (target?.closest(".todo-panel-done")) {
			runtime.todoDismissed = true;
			hide();
			return;
		}
		// Header (caret/title) → toggle collapse.
		if (target?.closest(".todo-panel-header")) {
			runtime.todoCollapsed = !runtime.todoCollapsed;
			render(runtime.todos, allCompleted(runtime.todos));
		}
	});
}

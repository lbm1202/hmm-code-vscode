// Slash-command autocomplete for the prompt textarea + the clean-dispatch
// helper that doSend() uses to route a recognized command straight to Pi
// (no chat echo, no optimistic spinner) instead of sending it to the model.
//
// The command list comes from the host's get_commands push (runtime.slashCommands).
// Keyboard navigation is intentionally NOT wired yet — selection is mouse-only;
// Escape and click-outside dismiss the menu.

import { els } from "./dom";
import { runtime } from "./state";
import type { SlashCommand } from "./protocol";

/** The command token currently being typed: a leading "/" followed by a single
 *  run of non-space chars (i.e. the user hasn't started typing args yet). */
const COMMAND_TOKEN = /^\/([^\s]*)$/;

/** Commands that exist for Pi/TUI but shouldn't be suggested in the chat. These
 *  still clean-dispatch if typed in full — they're just hidden from discovery.
 *  `plan-execute` is the TUI engine behind finalize_plan's new-session handoff;
 *  in the VS Code flow finalize_plan's dialog is the proper entry point. */
const HIDDEN_FROM_MENU: ReadonlySet<string> = new Set(["plan-execute"]);

/** The first whitespace-delimited token of `text`, minus its leading slash. */
function commandName(text: string): string {
	const sp = text.indexOf(" ");
	return (sp === -1 ? text.slice(1) : text.slice(1, sp)).toLowerCase();
}

/** The registered command `text` invokes, if any (exact name match). */
function matchCommand(text: string): SlashCommand | undefined {
	if (!text.startsWith("/")) return undefined;
	const name = commandName(text);
	return runtime.slashCommands.find((c) => c.name.toLowerCase() === name);
}

/** True when `text` is a recognized extension command — one that runs a handler
 *  with no LLM turn, so it should be dispatched without a user-message echo.
 *  Skills/prompt templates expand into a message to the model, so they fall
 *  through to the normal send path (they DO want the echo + turn). */
export function isCleanCommand(text: string): boolean {
	if (!text.startsWith("/")) return false;
	// Command list not loaded yet (cold-session race): assume a /-prefixed token
	// is a command and dispatch it echo-free. Otherwise it would fall to the
	// normal send path and strand the optimistic spinner — an extension command
	// emits no turn lifecycle, so the spinner would never clear.
	if (runtime.slashCommands.length === 0) return /^\/\S/.test(text);
	return matchCommand(text)?.source === "extension";
}

export function hideSlashMenu(): void {
	const menu = els().slashMenu;
	menu.classList.add("hidden");
	menu.replaceChildren();
}

/** Recompute the menu from the current textarea value. Shows the filtered
 *  command list while the user is typing a "/command" token; hides otherwise. */
export function updateSlashMenu(): void {
	const value = els().prompt.value;
	const m = COMMAND_TOKEN.exec(value);
	if (!m || runtime.slashCommands.length === 0) {
		hideSlashMenu();
		return;
	}
	const query = m[1].toLowerCase();
	const matches = runtime.slashCommands.filter(
		(c) => !HIDDEN_FROM_MENU.has(c.name) && c.name.toLowerCase().startsWith(query),
	);
	if (matches.length === 0) {
		hideSlashMenu();
		return;
	}
	renderMenu(matches);
}

function renderMenu(commands: SlashCommand[]): void {
	const menu = els().slashMenu;
	menu.replaceChildren();
	for (const cmd of commands) {
		const item = document.createElement("div");
		item.className = "slash-item";
		const name = document.createElement("span");
		name.className = "slash-name";
		name.textContent = `/${cmd.name}`;
		const desc = document.createElement("span");
		desc.className = "slash-desc";
		desc.textContent = cmd.description || "";
		item.append(name, desc);
		// mousedown (not click): fires before the textarea loses focus, so the
		// menu's blur-dismiss doesn't race the selection.
		item.addEventListener("mousedown", (ev) => {
			ev.preventDefault();
			selectCommand(cmd);
		});
		menu.append(item);
	}
	menu.classList.remove("hidden");
}

/** Fill the textarea with the chosen command (trailing space for args) and
 *  return focus to it. Does not send — the user adds args / presses Enter. */
function selectCommand(cmd: SlashCommand): void {
	const ta = els().prompt;
	ta.value = `/${cmd.name} `;
	hideSlashMenu();
	ta.focus();
	ta.selectionStart = ta.selectionEnd = ta.value.length;
}

/** Wire input / dismiss listeners once at boot. */
export function wireSlashMenu(): void {
	const ta = els().prompt;
	ta.addEventListener("input", updateSlashMenu);
	ta.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape" && !els().slashMenu.classList.contains("hidden")) {
			ev.preventDefault();
			hideSlashMenu();
		}
	});
	// Click anywhere outside the prompt area dismisses the menu.
	document.addEventListener("mousedown", (ev) => {
		const area = els().prompt.closest(".prompt-area");
		if (area && !area.contains(ev.target as Node)) hideSlashMenu();
	});
	// "/" toolbar button: seed the textarea with "/" (if not already a command)
	// and open the full command list. Toggles closed if it's already showing.
	els().btnSlash.addEventListener("click", () => {
		if (!els().slashMenu.classList.contains("hidden")) {
			hideSlashMenu();
			return;
		}
		if (!ta.value.startsWith("/")) ta.value = "/";
		ta.focus();
		ta.selectionStart = ta.selectionEnd = ta.value.length;
		updateSlashMenu();
	});
}

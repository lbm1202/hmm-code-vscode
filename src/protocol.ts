// Host-side protocol surface. The shared host ↔ webview kind/status constants
// live in protocol-shared.ts and are re-exported here so existing `./protocol`
// imports keep working; host-only additions live below.

export { TO_WEBVIEW, FROM_WEBVIEW, STATUS_KEYS } from "./protocol-shared";

/** Pi RPC commands that imply we should resync get_state and emit session_start. */
export const SESSION_RESET_COMMANDS = new Set<string>([
	"new_session",
	"switch_session",
	"fork",
	"clone",
]);

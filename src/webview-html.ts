// Shared webview HTML helpers used by both the chat view (chat-backend.ts)
// and the settings panel (settings-panel.ts). Kept in one place so the CSP /
// nonce policy can't drift between the two surfaces.

import * as vscode from "vscode";

/** Random nonce for the CSP `script-src 'nonce-…'` allowlist. Not security-
 *  critical beyond CSP (it only needs to be unguessable per page render), so
 *  Math.random is sufficient. */
export function makeNonce(): string {
	let out = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
	return out;
}

/** Restrictive Content-Security-Policy for our webviews: only nonce'd scripts,
 *  styles from the webview source (+ inline for our injected `<style>`), images
 *  from source + data:. `fontSrc` differs per panel — the chat view serves
 *  bundled fonts via `webview.cspSource`; the settings panel ships none, so it
 *  defaults to `'self'`. */
export function buildCsp(webview: vscode.Webview, nonce: string, fontSrc = "'self'"): string {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${fontSrc}`,
		`img-src ${webview.cspSource} data:`,
	].join("; ");
}

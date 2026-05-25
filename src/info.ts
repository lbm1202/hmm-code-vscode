// Extract version + publisher from the extension's own package.json.
// VS Code populates ctx.extension.packageJSON at activation time, so this
// stays in lock-step with whatever ships in the .vsix.

import type * as vscode from "vscode";
import type { RenderInfo } from "./chat-backend";

export function renderInfoFromContext(ctx: vscode.ExtensionContext): RenderInfo {
	const pkg = ctx.extension?.packageJSON ?? {};
	return {
		version: typeof pkg.version === "string" ? pkg.version : "?",
		publisher: typeof pkg.publisher === "string" ? pkg.publisher : "?",
	};
}

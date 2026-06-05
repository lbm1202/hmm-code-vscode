// Webview-side i18n. The host injects the merged locale dict as
// window.__HMM_I18N before the bundle loads (see chat-backend renderChatHtml).
// t() reads from it with the same {param} substitution as the host i18n.
//
// Tool-call rendering (tools.ts) also routes through t() (the tool.* keys),
// so tool-call blocks localize with the rest of the chat.

type Params = Record<string, string | number>;

const DICT: Record<string, string> =
	((window as unknown as { __HMM_I18N?: Record<string, string> }).__HMM_I18N) ?? {};

export function t(key: string, params?: Params): string {
	const tpl = DICT[key] ?? key;
	if (!params) return tpl;
	return tpl.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? String(params[k]) : `{${k}}`));
}

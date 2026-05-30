// Pure model alias + allowlist helpers shared by the host (chat-backend) and
// the settings webview (settings-pickers, bundled separately by esbuild). The
// per-model allowlist predicate used to be reimplemented on both sides; it now
// lives here so the chat picker and the settings dropdowns can't disagree.

/** modes.json:modelAliases key for a model: "provider/id", or bare "id" when
 *  the provider is unknown. */
export function aliasKey(provider: string | undefined, id: string): string {
	return provider ? `${provider}/${id}` : id;
}

/** Find the alias for (provider, id). Tries "provider/id" first, then bare id. */
export function findAlias(
	aliases: Record<string, string>,
	provider: string | undefined,
	id: string,
): string | undefined {
	if (provider) {
		const fq = aliases[`${provider}/${id}`];
		if (fq) return fq;
	}
	return aliases[id];
}

/** Whether a model passes the per-provider allowlist.
 *   - provider key missing → allowed (no filter for that provider)
 *   - provider key = [...]  → allowed only if id is in the list
 *   - provider key = []     → never allowed (explicit hide-all) */
export function isModelAllowed(
	allowlist: Record<string, string[]>,
	provider: string,
	id: string,
): boolean {
	const allowed = allowlist[provider];
	if (!allowed) return true;
	return allowed.includes(id);
}

/** Filter a model list by the per-provider allowlist. No filters → unchanged. */
export function applyAllowlist<T extends { provider: string; id: string }>(
	models: T[],
	allowlist: Record<string, string[]>,
): T[] {
	if (Object.keys(allowlist).length === 0) return models;
	return models.filter((m) => isModelAllowed(allowlist, m.provider, m.id));
}

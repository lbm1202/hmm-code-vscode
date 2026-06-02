// Session file I/O. Pi RPC doesn't expose enumeration/rename/delete for
// non-current sessions, so we drive the on-disk JSONL directly.
//
// Layout: ~/.pi/agent/sessions/<dirName>/<sessionId>.jsonl
//   dirName = "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--"
// Plus a sidecar .pi-modes-names.json keyed by basename with user-chosen names
// (rename via the session picker).

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface SessionEntry {
	file: string;
	name: string;
	mtimeMs: number;
	parentFile?: string; // absolute path to parent session file (if any)
}

const SIDECAR_FILENAME = ".pi-modes-names.json";

function sessionsDir(cwd: string): string {
	const dirName = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(homedir(), ".pi", "agent", "sessions", dirName);
}

function sidecarPath(anyFileInDir: string): string {
	const dir = anyFileInDir.replace(/\/[^/]+$/, "");
	return join(dir, SIDECAR_FILENAME);
}

function readNamesMap(path: string): Record<string, string> {
	try {
		if (!existsSync(path)) return {};
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
	} catch {
		return {};
	}
}

/**
 * Read the latest session name and the parent session file from a Pi session
 * JSONL. The first line is the header (with optional parentSession); subsequent
 * session_info entries carry rename history (latest wins).
 */
function readSessionMeta(file: string): { name?: string; parentFile?: string } {
	let text: string;
	try {
		text = readFileSync(file, "utf-8");
	} catch {
		return {};
	}
	const lines = text.split("\n");
	let parentFile: string | undefined;
	if (lines.length > 0 && lines[0]) {
		try {
			const header = JSON.parse(lines[0]);
			if (header?.type === "session" && typeof header.parentSession === "string") {
				parentFile = header.parentSession;
			}
		} catch {
			/* ignore malformed header */
		}
	}
	let name: string | undefined;
	for (let i = lines.length - 1; i >= 1; i--) {
		const line = lines[i];
		if (!line || !line.includes('"session_info"')) continue;
		try {
			const obj = JSON.parse(line);
			if (obj?.type === "session_info" && typeof obj.name === "string" && obj.name) {
				name = obj.name;
				break;
			}
		} catch {
			/* skip */
		}
	}
	return { name, parentFile };
}

/** List sessions for the workspace cwd, newest first. */
export function listSessions(cwd: string): SessionEntry[] {
	const dir = sessionsDir(cwd);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	// Sidecar (user-chosen names) wins over Pi-stored auto-title, which wins
	// over the filename.
	const sidecar = readNamesMap(join(dir, SIDECAR_FILENAME));
	const out: SessionEntry[] = [];
	for (const f of entries) {
		if (!f.endsWith(".jsonl")) continue;
		const full = join(dir, f);
		try {
			const st = statSync(full);
			const meta = readSessionMeta(full);
			const name = sidecar[f] ?? meta.name ?? f.replace(/\.jsonl$/, "");
			out.push({ file: full, name, mtimeMs: st.mtimeMs, parentFile: meta.parentFile });
		} catch {
			/* skip unreadable files */
		}
	}
	out.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return out;
}

/** Compute the cascade set for `file` — the file itself plus every
 *  descendant (transitive children via parentFile). Returned as a Set
 *  so callers can do O(1) membership tests (e.g. "is the active session
 *  about to be wiped?"). Paths compared case-insensitively because the
 *  workspace cwd and Pi's stored parentSession can differ in case on
 *  macOS/Windows (case-insensitive FS, case-preserving strings). */
export function collectCascade(file: string, cwd: string): Set<string> {
	const all = listSessions(cwd);
	const lowerToFile = new Map<string, string>();
	for (const s of all) lowerToFile.set(s.file.toLowerCase(), s.file);
	const childrenOf = new Map<string, string[]>();
	for (const s of all) {
		if (!s.parentFile) continue;
		const parentCanonical = lowerToFile.get(s.parentFile.toLowerCase());
		if (!parentCanonical) continue;
		const list = childrenOf.get(parentCanonical) ?? [];
		list.push(s.file);
		childrenOf.set(parentCanonical, list);
	}
	const startCanonical = lowerToFile.get(file.toLowerCase()) ?? file;
	const set = new Set<string>();
	const queue: string[] = [startCanonical];
	while (queue.length > 0) {
		const f = queue.shift()!;
		if (set.has(f)) continue;
		set.add(f);
		for (const k of childrenOf.get(f) ?? []) queue.push(k);
	}
	return set;
}

export interface ModelUsage {
	input: number;
	output: number;
}

/** Sum input/output tokens per model id across one session's assistant
 *  messages. Each assistant message carries its own `model` + `usage`, so
 *  multi-model and branched sessions attribute correctly. */
export function sessionUsage(file: string): Record<string, ModelUsage> {
	const out: Record<string, ModelUsage> = {};
	let text: string;
	try {
		text = readFileSync(file, "utf-8");
	} catch {
		return out;
	}
	for (const line of text.split("\n")) {
		if (!line || !line.includes('"usage"')) continue;
		try {
			const o = JSON.parse(line);
			const m = (o.message ?? o) as {
				role?: string;
				model?: unknown;
				modelId?: unknown;
				usage?: { input?: number; output?: number; inputTokens?: number; outputTokens?: number };
			};
			if (m.role !== "assistant" || !m.usage) continue;
			const model =
				typeof m.model === "string"
					? m.model
					: ((m.model as { id?: string })?.id ??
						(typeof m.modelId === "string" ? m.modelId : "unknown"));
			const e = (out[model] ??= { input: 0, output: 0 });
			e.input += Number(m.usage.input ?? m.usage.inputTokens ?? 0) || 0;
			e.output += Number(m.usage.output ?? m.usage.outputTokens ?? 0) || 0;
		} catch {
			/* skip malformed line */
		}
	}
	return out;
}

/** Aggregate per-model token usage across a session AND all its descendants
 *  (a parent includes its children). Returns combined per-model totals plus the
 *  number of sessions counted (1 = no children). */
export function subtreeUsage(
	file: string,
	cwd: string,
): { perModel: Record<string, ModelUsage>; sessionCount: number } {
	const files = collectCascade(file, cwd); // file + all descendants
	const perModel: Record<string, ModelUsage> = {};
	for (const f of files) {
		for (const [model, mu] of Object.entries(sessionUsage(f))) {
			const e = (perModel[model] ??= { input: 0, output: 0 });
			e.input += mu.input;
			e.output += mu.output;
		}
	}
	return { perModel, sessionCount: files.size };
}

/** Delete a session and all descendants (BFS via parentFile pointer). */
export function deleteSession(file: string, cwd: string): void {
	const toDelete = [...collectCascade(file, cwd)];

	const namesPath = sidecarPath(file);
	const namesMap = existsSync(namesPath) ? readNamesMap(namesPath) : undefined;
	for (const f of toDelete) {
		try {
			rmSync(f);
		} catch (err) {
			console.error(`[hmm-code:session-manager] failed to delete ${f}:`, err);
		}
		if (namesMap) delete namesMap[basename(f)];
	}
	if (namesMap) {
		try {
			writeFileSync(namesPath, JSON.stringify(namesMap, null, 2), "utf-8");
		} catch (err) {
			console.error(`[hmm-code:session-manager] failed to rewrite sidecar ${namesPath}:`, err);
		}
	}
}

/** Rename a session (sidecar override; empty name removes the override). */
export function renameSession(file: string, name: string): void {
	const namesPath = sidecarPath(file);
	const map = readNamesMap(namesPath);
	const trimmed = name.trim();
	if (trimmed) map[basename(file)] = trimmed;
	else delete map[basename(file)];
	writeFileSync(namesPath, JSON.stringify(map, null, 2), "utf-8");
}

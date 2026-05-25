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

/** Delete a session and all descendants (BFS via parentFile pointer). */
export function deleteSession(file: string, cwd: string): void {
	const all = listSessions(cwd);
	const childrenOf = new Map<string, string[]>();
	for (const s of all) {
		if (!s.parentFile) continue;
		const list = childrenOf.get(s.parentFile) ?? [];
		list.push(s.file);
		childrenOf.set(s.parentFile, list);
	}
	const toDelete: string[] = [];
	const queue: string[] = [file];
	while (queue.length > 0) {
		const f = queue.shift()!;
		toDelete.push(f);
		for (const k of childrenOf.get(f) ?? []) queue.push(k);
	}

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

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	RESPONDING_METHODS,
	type RpcCommand,
	type RpcEvent,
	type RpcExtensionUiRequest,
	type RpcExtensionUiResponse,
	type RpcResponse,
	type IncomingMessage,
} from "./rpc-types";

export interface PiClientOptions {
	piBin?: string; // defaults to "pi" on PATH
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	args?: string[]; // extra args passed before --mode rpc
}

type PendingResponse = {
	resolve: (value: RpcResponse) => void;
	reject: (err: Error) => void;
	timeout: NodeJS.Timeout;
};

/**
 * Spawns `pi --mode rpc`, frames JSONL (LF-delimited, no readline because it
 * also splits on U+2028/U+2029 which can appear in JSON strings), and exposes
 * an EventEmitter. Events emitted to listeners:
 *  - "event"        — lifecycle / streaming events (agent_start, message_update, …)
 *  - "ui-request"   — extension UI request requiring a response (select/confirm/input/editor)
 *  - "ui-hint"      — fire-and-forget UI updates (notify/setStatus/…)
 *  - "stderr"       — stderr chunks
 *  - "exit"         — { code, signal }
 *  - "error"        — spawn / IO errors
 *  - "parse-error"  — { line, err } for unparseable JSON
 */
export class PiClient extends EventEmitter {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private stdoutBuf = "";
	private pending = new Map<string, PendingResponse>();
	private nextId = 1;

	start(opts: PiClientOptions = {}): void {
		if (this.proc) throw new Error("PiClient already started");
		const piBin = opts.piBin ?? "pi";
		const args = [...(opts.args ?? []), "--mode", "rpc"];
		this.proc = spawn(piBin, args, {
			cwd: opts.cwd,
			env: opts.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
		this.proc.stderr.setEncoding("utf8");
		this.proc.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
		this.proc.on("exit", (code, signal) => {
			this.emit("exit", { code, signal });
			this.proc = null;
			for (const p of this.pending.values()) {
				clearTimeout(p.timeout);
				p.reject(new Error(`pi exited (code=${code ?? "?"}, signal=${signal ?? "?"})`));
			}
			this.pending.clear();
		});
		this.proc.on("error", (err) => {
			// Guard the emit: EventEmitter throws on an 'error' with no listener,
			// which would crash the host. ChatBackend detaches its listeners
			// during restart(), so a late process error must not be fatal.
			if (this.listenerCount("error") > 0) this.emit("error", err);
			else console.error("[pi-client] process error (no listener):", err);
		});
		// A write to a pi that has exited emits 'error' (EPIPE) on the stdin
		// stream. Without this listener Node promotes it to an uncaughtException
		// and crashes the extension host. Re-emit only if someone is listening
		// (EventEmitter throws on an unhandled 'error'); a broken pipe to an
		// already-dead pi is otherwise not actionable.
		this.proc.stdin.on("error", (err) => {
			if (this.listenerCount("error") > 0) this.emit("error", err);
		});
	}

	stop(): void {
		const proc = this.proc;
		if (!proc) return;
		// Null immediately so new sends fail fast instead of writing to a pipe
		// we're tearing down. The 'exit' handler above still runs to reject
		// pending requests.
		this.proc = null;
		try {
			proc.stdin.end();
		} catch {}
		try {
			proc.kill(); // SIGTERM
		} catch {}
		// Escalate to SIGKILL if it doesn't exit promptly (hung in a syscall or
		// ignoring SIGTERM) so we don't leak a zombie still holding the session
		// JSONL file handle.
		const killTimer = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {}
		}, 2000);
		killTimer.unref?.();
		proc.once("exit", () => clearTimeout(killTimer));
	}

	/** Send a command. Returns the matching response (success or error). */
	send(cmd: RpcCommand, timeoutMs = 30_000): Promise<RpcResponse> {
		// Reject (not throw) so every failure path is a rejected promise — a
		// synchronous throw from an async-looking method surprises callers that
		// only `.catch()`.
		if (!this.proc) return Promise.reject(new Error("PiClient not started"));
		const id = cmd.id ?? `c${this.nextId++}`;
		const payload = { ...cmd, id };
		const line = JSON.stringify(payload) + "\n";
		return new Promise<RpcResponse>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout: ${cmd.type} (${id})`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
			this.proc!.stdin.write(line, (err) => {
				if (err) {
					clearTimeout(timeout);
					this.pending.delete(id);
					reject(err);
				}
			});
		});
	}

	/** Fire-and-forget command (no response correlated). */
	sendNoReply(cmd: RpcCommand): void {
		this.writeLine(JSON.stringify(cmd) + "\n");
	}

	/** Reply to an extension_ui_request. */
	sendUiResponse(res: RpcExtensionUiResponse): void {
		this.writeLine(JSON.stringify(res) + "\n");
	}

	/** Guarded fire-and-forget write. Silently no-ops when pi isn't running or
	 *  the pipe is gone — these paths (abort, UI responses) have no caller to
	 *  surface an error to, and an unguarded write on a dead pipe throws/EPIPEs. */
	private writeLine(line: string): void {
		const stdin = this.proc?.stdin;
		if (!stdin || stdin.destroyed) return;
		try {
			stdin.write(line);
		} catch {
			/* broken pipe — pi already gone */
		}
	}

	// ── Internals ────────────────────────────────────────────────────────────

	private onStdout(chunk: string): void {
		this.stdoutBuf += chunk;
		let nl: number;
		while ((nl = this.stdoutBuf.indexOf("\n")) !== -1) {
			const line = this.stdoutBuf.slice(0, nl);
			this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
			if (line.length === 0) continue;
			this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let msg: IncomingMessage;
		try {
			msg = JSON.parse(line) as IncomingMessage;
		} catch (err) {
			this.emit("parse-error", { line, err });
			return;
		}

		const type = (msg as { type?: string }).type;

		// Command response
		if (type === "response") {
			const r = msg as RpcResponse;
			if (r.id) {
				const p = this.pending.get(r.id);
				if (p) {
					clearTimeout(p.timeout);
					this.pending.delete(r.id);
					p.resolve(r);
					return;
				}
			}
			// Unmatched response (no id correlation) — surface as event for visibility.
			this.emit("event", msg as RpcEvent);
			return;
		}

		// Extension UI request — route on method
		if (type === "extension_ui_request") {
			const req = msg as RpcExtensionUiRequest;
			if (RESPONDING_METHODS.has(req.method)) {
				this.emit("ui-request", req);
			} else {
				this.emit("ui-hint", req);
			}
			return;
		}

		// Everything else is a lifecycle / streaming event
		this.emit("event", msg as RpcEvent);
	}
}

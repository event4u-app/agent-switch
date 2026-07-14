/**
 * Embedded-terminal wiring: connect a terminal UI (xterm.js) to the Rust pty
 * backend (`term_open`/`term_write`/`term_resize`/`term_close`). Split into a
 * pure controller (`attachTerminal`) over injected deps so the wiring is
 * unit-testable without a real pty or a real xterm instance.
 */

import { Channel, invoke } from "@tauri-apps/api/core";

export type TermEvent = { kind: "data"; data: string } | { kind: "exit"; code: number | null };

/** The subset of xterm.js the controller needs. */
export interface TerminalLike {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  readonly rows: number;
  readonly cols: number;
}

/** The pty backend the controller drives. */
export interface TermBackend {
  open(args: string[], rows: number, cols: number, onEvent: (e: TermEvent) => void): Promise<number>;
  write(id: number, data: string): Promise<void>;
  resize(id: number, rows: number, cols: number): Promise<void>;
  close(id: number): Promise<void>;
}

export interface TerminalController {
  resize(rows: number, cols: number): void;
  dispose(): Promise<void>;
}

/**
 * Attach `term` to `backend` running `agent-switch <args>`. Streams pty output
 * into the terminal, forwards keystrokes to the pty, and calls `onExit` when
 * the process ends. Returns a controller for resize + teardown.
 */
export function attachTerminal(
  term: TerminalLike,
  backend: TermBackend,
  args: string[],
  onExit: (code: number | null) => void,
): TerminalController {
  let id: number | null = null;
  let closed = false;

  const opened = backend
    .open(args, term.rows, term.cols, (e) => {
      if (e.kind === "data") term.write(e.data);
      else if (!closed) onExit(e.code);
    })
    .then((newId) => {
      id = newId;
      return newId;
    });

  term.onData((data) => {
    if (id !== null) void backend.write(id, data);
  });

  return {
    resize(rows, cols) {
      if (id !== null) void backend.resize(id, rows, cols);
    },
    async dispose() {
      closed = true;
      await opened.catch(() => undefined);
      if (id !== null) await backend.close(id).catch(() => undefined);
    },
  };
}

/** The real backend: a Tauri channel for streamed output + invoke commands. */
export const tauriBackend: TermBackend = {
  open(args, rows, cols, onEvent) {
    const channel = new Channel<TermEvent>();
    channel.onmessage = onEvent;
    return invoke<number>("term_open", { onEvent: channel, args, rows, cols });
  },
  write(id, data) {
    return invoke("term_write", { id, data });
  },
  resize(id, rows, cols) {
    return invoke("term_resize", { id, rows, cols });
  },
  close(id) {
    return invoke("term_close", { id });
  },
};

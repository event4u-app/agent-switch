/**
 * Runs inside the page (via page.addInitScript) BEFORE any app code: installs a
 * fake Tauri runtime. Shell `execute` is forwarded to Node (window.__asHost,
 * exposed by capture.mjs); app commands answer from a static table; anything
 * unknown resolves null and is reported to Node (window.__asLog).
 *
 * Must stay self-contained — Playwright serialises this function's source.
 */
export function installTauriShim({ statics, windowLabel, storage }) {
  for (const [k, v] of Object.entries(storage)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked — the app falls back to its default theme */
    }
  }

  // The notification plugin consults the web Notification API first.
  class FakeNotification {
    static permission = "granted";
    static requestPermission() {
      return Promise.resolve("granted");
    }
    constructor() {}
    close() {}
  }
  window.Notification = FakeNotification;

  const callbacks = new Map();
  let nextId = 1;
  const listeners = new Map(); // event name → [{ id, handler }]

  function transformCallback(cb, once = false) {
    const id = nextId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  }

  function deliver(event, payload) {
    for (const l of listeners.get(event) ?? []) {
      const cb = callbacks.get(l.handler);
      if (cb) cb({ event, id: l.id, payload });
    }
  }

  // Long-lived children (the chat bridge): the host spawns, lines come back on the Channel.
  const children = new Map(); // pid → { channel, index }
  window.__asChild = (pid, event) => {
    const c = children.get(pid);
    if (!c) return;
    const cb = callbacks.get(c.channel);
    if (cb) cb({ message: event, index: c.index++ });
  };

  async function invoke(cmd, args = {}) {
    if (cmd === "plugin:shell|execute") {
      return window.__asHost({ program: args.program, args: args.args ?? [], options: args.options ?? {} });
    }
    if (cmd === "plugin:shell|spawn") {
      if (!window.__asSpawn) throw new Error("spawn is not available in this harness");
      const pid = await window.__asSpawn({ program: args.program, args: args.args ?? [], options: args.options ?? {} });
      children.set(pid, { channel: args.onEvent.id, index: 0 });
      return pid;
    }
    if (cmd === "plugin:shell|stdin_write") {
      const data = typeof args.buffer === "string" ? args.buffer : new TextDecoder().decode(new Uint8Array(args.buffer));
      return window.__asStdin(args.pid, data);
    }
    if (cmd === "plugin:shell|kill") return window.__asKill(args.pid);
    if (cmd === "plugin:event|listen") {
      const id = nextId++;
      const arr = listeners.get(args.event) ?? [];
      arr.push({ id, handler: args.handler });
      listeners.set(args.event, arr);
      return id;
    }
    if (cmd === "plugin:event|unlisten") {
      const arr = listeners.get(args.event) ?? [];
      listeners.set(
        args.event,
        arr.filter((l) => l.id !== args.eventId),
      );
      return null;
    }
    if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") {
      if (cmd === "plugin:event|emit" || args.target?.label === windowLabel || args.target === windowLabel) deliver(args.event, args.payload);
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(statics, cmd)) return structuredClone(statics[cmd]);
    // Window / webview plumbing (size, position, focus, theme…) — harmless no-ops.
    if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
    window.__asLog?.(`unknown invoke: ${cmd} ${JSON.stringify(args).slice(0, 200)}`);
    return null;
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (p, protocol = "asset") => `${protocol}://localhost/${encodeURIComponent(p)}`,
    metadata: {
      currentWindow: { label: windowLabel },
      currentWebview: { windowLabel, label: windowLabel },
    },
    plugins: { path: { sep: "/", delimiter: ":" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, id) => {
      const arr = listeners.get(event) ?? [];
      listeners.set(
        event,
        arr.filter((l) => l.id !== id),
      );
    },
  };
}

/** What the session bar's [Terminal | Chat] switch does now (Phase 4). Pure:
 *  a switch happens only between turns; asked for during one, it is armed. */

export type ViewStep =
  | { do: "none" }
  | { do: "no-terminal" }
  | { do: "arm"; to: "terminal" | "chat" }
  | { do: "close-chat" }
  | { do: "restore" }
  | { do: "open-chat" };

export function viewStep(to: "terminal" | "chat", s: { inChat: boolean; hosted: boolean; parked?: boolean; chatRunning: boolean; terminalRunning: boolean }): ViewStep {
  if (to === "terminal") {
    // Parked for a chat this window no longer runs (it ended, or the window reloaded): bring the program back.
    if (!s.inChat) return s.hosted && s.parked ? { do: "restore" } : { do: "none" };
    if (!s.hosted) return { do: "no-terminal" };
    return s.chatRunning ? { do: "arm", to } : { do: "close-chat" };
  }
  if (s.inChat) return { do: "none" };
  return s.terminalRunning ? { do: "arm", to } : { do: "open-chat" };
}

/** A hosted session parked for the chat was last seen in the chat: opened in a window that runs
 *  no chat for it (an app restart, a reload), the chat comes back. Pure. */
export function resumesChat(s: { inChat: boolean; hosted: boolean; parked: boolean }): boolean {
  return s.hosted && s.parked && !s.inChat;
}

export type OwnView = "terminal" | "chat";
export const OWN_VIEWS_STORAGE = "agent-switch.ownViews";
/** Sessions whose view is remembered; the oldest choices go first. */
export const OWN_VIEWS_MAX = 300;

/** The remembered view of each session that runs in the user's own terminal. Anything unreadable is no memory. */
export function loadOwnViews(raw: string | null): Map<string, OwnView> {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return new Map();
    return new Map(list.filter((e): e is [string, OwnView] => Array.isArray(e) && typeof e[0] === "string" && (e[1] === "terminal" || e[1] === "chat")).slice(-OWN_VIEWS_MAX));
  } catch {
    return new Map();
  }
}

/** One choice, newest last; the list stays at OWN_VIEWS_MAX. Pure. */
export function rememberOwnView(m: ReadonlyMap<string, OwnView>, key: string, view: OwnView): Map<string, OwnView> {
  const n = new Map(m);
  n.delete(key);
  n.set(key, view);
  return new Map([...n].slice(-OWN_VIEWS_MAX));
}

/** When a parked session's chat comes back by itself, per window: once per opening of the session,
 *  never after the person chose the terminal here, again after a chat they chose ended or a try failed. */
export class ResumeGate {
  private readonly held = new Set<string>();
  /** The session was opened while parked with no chat here: bring the chat back now? */
  take(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }
  /** The person (or a resume) settled the view: the terminal holds the gate shut, an open chat releases it. */
  chose(key: string, view: "terminal" | "chat"): void {
    if (view === "terminal") this.held.add(key);
    else this.held.delete(key);
  }
  /** Opening the chat failed: opening the session again tries again. */
  failed(key: string): void {
    this.held.delete(key);
  }
}

/** A while after a chat was closed for the terminal: bring the program back only if the window still
 *  waits and no chat was opened for it again meanwhile. Pure. */
export function afterChatClosed(now: { chatOpen: boolean; parked: boolean }): "restore" | "refresh" {
  return !now.chatOpen && now.parked ? "restore" : "refresh";
}

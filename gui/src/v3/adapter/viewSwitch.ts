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

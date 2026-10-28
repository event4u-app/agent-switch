import { useState } from "react";
import { ExternalLink, LoaderCircle, ShieldAlert } from "lucide-react";
import { listProfiles } from "../../ipc.js";
import { tauriBackend } from "../../terminal.js";
import type { ProviderId } from "../../transforms.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card, DefinitionList } from "../../ui/Card.js";
import { ago, expiry } from "../../ui/format.js";
import { Dialog } from "../../ui/Overlay.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Tool } from "../../vm/types.js";
import { providerOf, signInArgs, signInOutcome } from "./account-logic.js";
import { XtermBox } from "./terminal-sheet.js";

const SIGN_IN_WITH: Record<Tool, string> = {
  claude: "Sign in with Claude",
  codex: "Sign in with ChatGPT",
  gemini: "Sign in with Google",
  antigravity: "Sign in with Google",
};

/** The identity `list` reports for one profile right now; null = none. */
export async function readIdentity(provider: ProviderId, name: string): Promise<{ exists: boolean; identity: string | null }> {
  const row = (await listProfiles()).find((r) => r.provider === provider && r.name === name);
  return { exists: !!row, identity: row?.identity ?? null };
}

type Step = "start" | "pending" | "verified" | "mismatch";

/** Sign in / Sign in again. Bundle `DP` (dialog 540). The provider login runs in
 *  the built-in terminal; afterwards the identity is read again and compared. */
export function ReauthDialog({ accountId }: { accountId: string }) {
  const s = useAS();
  const a = s.accountById(accountId);
  const [step, setStep] = useState<Step>("start");
  const [run, setRun] = useState(0);
  const [seen, setSeen] = useState<string | null>(null);
  if (!a) return null;
  const provider = providerOf(a.tool);
  const waiting = s.sessions.filter((x) => x.accountId === a.id && x.state === "auth-paused");
  const first = !a.identity;
  const before = a.identity;

  async function finished(code: number | null) {
    if (!provider || !a) return;
    try {
      const now = await readIdentity(provider, a.name);
      const outcome = code === 0 || code == null ? signInOutcome(before, now.identity) : "unfinished";
      setSeen(now.identity);
      if (outcome === "unfinished") {
        setStep("start");
        s.toast({ tone: "warn", text: "The sign-in didn't finish — nothing changed. Try again." });
      } else setStep(outcome);
    } catch (e) {
      setStep("start");
      s.toast({ tone: "alert", text: `Couldn't read the sign-in: ${e instanceof Error ? e.message : String(e)}` });
    }
    void s.reload();
  }

  const close = () => {
    s.close();
    if (step !== "start") void s.reload();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      kicker={first ? "Sign in" : "Sign in again"}
      title={
        <span className="inline-flex items-center gap-2.5">
          <AccountDot color={a.color} size={12} /> {TOOL_LABEL[a.tool]} · {a.name}
        </span>
      }
      width={540}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close}>
            Later
          </Button>
          <span className="flex-1" />
          {step === "start" && (
            <Button
              size="sm"
              variant="primary"
              disabled={!provider}
              title={provider ? undefined : `${TOOL_LABEL[a.tool]} has no sign-in backend yet.`}
              onClick={() => {
                setRun((n) => n + 1);
                setStep("pending");
              }}
            >
              <ExternalLink /> {SIGN_IN_WITH[a.tool]}
            </Button>
          )}
          {step === "pending" && (
            <Button size="sm" disabled>
              <LoaderCircle className="animate-spin" /> Waiting for the browser
            </Button>
          )}
          {step === "verified" && (
            <Button size="sm" variant="primary" onClick={close}>
              Done{waiting.length ? ` — continue ${waiting.length} session${waiting.length > 1 ? "s" : ""}` : ""}
            </Button>
          )}
          {step === "mismatch" && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setRun((n) => n + 1);
                setStep("pending");
              }}
            >
              <ExternalLink /> Try again
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {a.auth?.reason && step === "start" && (
          <Card className="flex items-start gap-3 p-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ac-warn" />
            <p className="text-[13px] text-ac-soft">{a.auth.reason}</p>
          </Card>
        )}
        {step === "start" && (
          <>
            <p className="text-[13px] text-ac-soft">
              The {TOOL_LABEL[a.tool]} sign-in opens in your browser — for this account only, in its own folder. Your other accounts and your normal{" "}
              {TOOL_LABEL[a.tool]} login stay as they are. Agent Switch never sees your password.
            </p>
            <DefinitionList
              rows={[
                ["Expected account", a.identity ?? "any — first sign-in"],
                ["Last refresh", a.auth?.lastRefreshAt ? ago(a.auth.lastRefreshAt, s.now) : "—"],
                ["Waiting sessions", waiting.length ? waiting.map((x) => x.project).join(", ") : "none"],
              ]}
            />
          </>
        )}
        {step === "pending" && provider && (
          <>
            <p className="text-[13px] text-ac-soft">Finish the sign-in in the browser. You can switch windows; this updates on its own.</p>
            <div className="flex h-[280px] overflow-hidden rounded-lg border border-ac-line bg-ac-bg p-3">
              <XtermBox key={run} args={signInArgs(provider, a.name, true)} backend={tauriBackend} onExit={(code) => void finished(code)} />
            </div>
          </>
        )}
        {step === "verified" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="ok" dot>
                Connected
              </Badge>
              <span className="text-[13px] text-ac-text">{seen ?? a.identity}</span>
            </div>
            <p className="text-xs text-ac-muted">
              {before ? "Same account as before. " : ""}
              {a.auth?.expiresAt ? `The sign-in now runs until ${expiry(a.auth.expiresAt, s.now)}.` : ""}
              {waiting.length ? " Paused sessions continue where they stopped — nothing is run twice." : ""}
            </p>
          </div>
        )}
        {step === "mismatch" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="alert" dot>
                Wrong account
              </Badge>
              <span className="text-[13px] text-ac-text">{seen}</span>
            </div>
            <p className="text-xs text-ac-muted">
              That sign-in belongs to a different account, and this account's folder now holds it. Sign in with {a.identity ?? "the account you want here"}, or add
              the other one as a new account.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

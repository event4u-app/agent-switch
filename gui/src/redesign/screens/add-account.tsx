import { useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { tauriBackend } from "../../terminal.js";
import type { ProfileLabel } from "../../transforms.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { Dialog } from "../../ui/Overlay.js";
import { Segmented } from "../../ui/Segmented.js";
import { Switch } from "../../ui/Switch.js";
import { TextInput } from "../../ui/TextInput.js";
import { colorFor } from "../../vm/build.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Tool } from "../../vm/types.js";
import { attempt } from "./account-actions.js";
import { ACCOUNT_NAME_RE, ACCOUNT_TOOLS, addBlocked, providerOf, SIGN_IN_TEXT, signInArgs } from "./account-logic.js";
import { ColourPicker, PoolsPicker, TagPicker } from "./account-sheet.js";
import { readIdentity } from "./reauth.js";
import { XtermBox } from "./terminal-sheet.js";

const STEPS = ["Provider", "Name", "Sign in", "Use in"];
const TITLES = ["Which provider?", "What should we call it?", "Sign in with the provider", "Where should it be used?"];

type SignIn = { state: "idle" } | { state: "pending"; run: number } | { state: "verified"; identity: string | null };

/** Add account wizard. Bundle `KP` (dialog 600). Step 3 runs `agent-switch add`
 *  in the built-in terminal; the account exists once it finishes. */
export function AddAccountDialog({ tool: initialTool }: { tool?: string }) {
  const s = useAS();
  const preset = ACCOUNT_TOOLS.find((t) => t === initialTool);
  const [step, setStep] = useState(preset ? 1 : 0);
  const [tool, setTool] = useState<Tool>(preset ?? "claude");
  const [name, setName] = useState("");
  const [label, setLabel] = useState<ProfileLabel | null>(null);
  const [pools, setPools] = useState<string[]>([]);
  const [method, setMethod] = useState<"browser" | "device">("browser");
  const [signIn, setSignIn] = useState<SignIn>({ state: "idle" });
  const [created, setCreated] = useState(false);
  const [runs, setRuns] = useState(0);

  const provider = providerOf(tool);
  const taken = s.accounts.some((a) => a.tool === tool && a.name === name);
  const nameOk = ACCOUNT_NAME_RE.test(name) && (!taken || created);
  const blocked = addBlocked(tool);

  function begin() {
    const run = runs + 1;
    setRuns(run);
    setSignIn({ state: "pending", run });
  }

  async function finished() {
    if (!provider) return;
    try {
      const r = await readIdentity(provider, name);
      if (r.exists) setCreated(true);
      if (r.exists) setSignIn({ state: "verified", identity: r.identity });
      else {
        setSignIn({ state: "idle" });
        s.toast({ tone: "warn", text: "The sign-in didn't finish — try again." });
      }
    } catch (e) {
      setSignIn({ state: "idle" });
      s.toast({ tone: "alert", text: `Couldn't read the new account: ${e instanceof Error ? e.message : String(e)}` });
    }
    void s.reload();
  }

  function done() {
    const id = `${tool}:${name}`;
    attempt(
      s,
      (async () => {
        if (label) await s.act.updateAccount?.(id, { label });
        for (const p of pools) await s.act.setPoolMembership?.(p, id, true);
      })(),
      `Couldn't finish ${name}`,
    );
    s.toast({ tone: "ok", text: `${TOOL_LABEL[tool]} · ${name} is added.` });
    s.close();
  }

  const close = () => {
    s.close();
    if (created) void s.reload();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      kicker={`Add account · step ${step + 1} of ${STEPS.length}`}
      title={TITLES[step]}
      width={600}
      footer={
        <>
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 2 && signIn.state === "pending"}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          {step < 3 ? (
            <Button
              size="sm"
              variant="primary"
              disabled={(step === 0 && !!blocked) || (step === 1 && (!nameOk || !label)) || (step === 2 && signIn.state !== "verified")}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={done}>
              <Check /> Done
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((x, i) => (
          <li key={x} className="flex flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
            <span className={cn("h-1 rounded-full", i <= step ? "bg-ac-brand" : "bg-ac-line")} />
            <span className={cn("text-[11px]", i === step ? "text-ac-text" : "text-ac-faint")}>
              {i + 1}. {x}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div role="radiogroup" aria-label="Provider" className="grid gap-2 sm:grid-cols-2">
          {ACCOUNT_TOOLS.map((t) => {
            const on = tool === t;
            const n = s.accounts.filter((a) => a.tool === t).length;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTool(t)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  on ? "border-transparent bg-ac-brand-tint shadow-[inset_0_0_0_1px_var(--ac-brand-line)]" : "border-ac-line hover:border-ac-line2",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-ac-text">{TOOL_LABEL[t]}</span>
                  {t === "antigravity" && <Badge>Monitor only</Badge>}
                </span>
                <span className="text-[11px] text-ac-muted">{n ? `${n} account${n > 1 ? "s" : ""} so far` : "No account yet"}</span>
              </button>
            );
          })}
          {blocked && <p className="text-xs text-ac-muted sm:col-span-2">{blocked}</p>}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="ac-caps" htmlFor="new-name">
              Name
            </label>
            <TextInput
              id="new-name"
              mono
              autoFocus
              className="h-9"
              value={name}
              placeholder="e.g. client-acme"
              disabled={created}
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
            <span className={cn("text-[11px]", taken && !created ? "text-ac-warn-text" : "text-ac-faint")}>
              {taken && !created ? `There is already a ${TOOL_LABEL[tool]} account named ${name}.` : "Lowercase letters, digits and dashes."}
            </span>
          </div>
          <TagPicker value={label} onChange={setLabel} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColourPicker value={colorFor(`${tool}:${name}`)} />
            <PoolsPicker value={pools} onChange={setPools} />
          </div>
        </div>
      )}

      {step === 2 && provider && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ac-soft">
            {SIGN_IN_TEXT[tool]}. Your existing login stays untouched — this account gets its own folder and keychain entry. Agent Switch never sees your password.
          </p>
          <Segmented
            label="Sign-in method"
            value={method}
            onChange={setMethod}
            options={[
              { value: "browser", label: "Browser" },
              {
                value: "device",
                label: "Device code",
                disabled: true,
                why: tool === "codex" ? "Device code sign-in isn't wired up in Agent Switch yet" : "Only Codex offers a device code",
              },
            ]}
          />
          <Card className="flex items-center gap-3 p-3">
            <AccountDot color={colorFor(`${tool}:${name}`)} size={12} />
            <span className="min-w-0 flex-1">
              <span className="block font-ac-mono text-xs text-ac-text">
                {TOOL_LABEL[tool]} · {name}
              </span>
              <span className="block text-[11px] text-ac-muted">
                {signIn.state === "idle" && "Not started"}
                {signIn.state === "pending" && "Waiting for the browser … you can switch windows."}
                {signIn.state === "verified" && (signIn.identity ? `Verified: ${signIn.identity}` : "Added — the sign-in can't be read yet; check it in the account.")}
              </span>
            </span>
            {signIn.state === "idle" && (
              <Button size="sm" variant="primary" onClick={begin}>
                <ExternalLink /> Open sign-in
              </Button>
            )}
            {signIn.state === "pending" && (
              <Button size="sm" disabled>
                <LoaderCircle className="animate-spin" /> Waiting
              </Button>
            )}
            {signIn.state === "verified" && (
              <Badge tone="ok" dot>
                Connected
              </Badge>
            )}
          </Card>
          {signIn.state === "pending" && (
            <div className="flex h-[240px] overflow-hidden rounded-lg border border-ac-line bg-ac-bg p-3">
              <XtermBox key={signIn.run} args={signInArgs(provider, name, created)} backend={tauriBackend} onExit={() => void finished()} />
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-ac-line p-3">
            <span>
              <span className="block text-[13px] text-ac-text">{TOOL_LABEL[tool]} CLI</span>
              <span className="block text-[11px] text-ac-muted">Plain `{tool}` picks it when a project binding or pool says so.</span>
            </span>
            <Badge tone="ok">Always</Badge>
          </label>
          {tool !== "gemini" && (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-ac-line p-3"
              title="Own launchers aren't available yet — open the app as this account from its ⋯ menu."
            >
              <span>
                <span className="block text-[13px] text-ac-text">{TOOL_LABEL[tool]} desktop app — own launcher</span>
                <span className="block text-[11px] text-ac-muted">
                  Opt-in. Adds a separate launcher in the account colour; your normal app icon stays as it is.
                </span>
              </span>
              <Switch label="Own desktop launcher" checked={false} onChange={() => {}} disabled />
            </div>
          )}
          <p className="text-[11px] text-ac-faint">Session protection is on (98 %). You can change everything later in the account.</p>
        </div>
      )}
    </Dialog>
  );
}

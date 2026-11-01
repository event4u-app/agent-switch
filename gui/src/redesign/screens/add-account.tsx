import { useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";
import { t, tp, type TKey } from "../../i18n/index.js";
import { tx } from "../../i18n/react.js";
import { cn } from "../../lib/utils.js";
import { tauriBackend } from "../../terminal.js";
import type { ProfileLabel } from "../../transforms.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { Copyable } from "../../ui/CopyButton.js";
import { Sheet } from "../../ui/Overlay.js";
import { Segmented } from "../../ui/Segmented.js";
import { TextInput } from "../../ui/TextInput.js";
import { colorFor } from "../../vm/build.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { IdentityColor, Tool } from "../../vm/types.js";
import { attempt } from "./account-actions.js";
import { ACCOUNT_NAME_RE, ACCOUNT_TOOLS, addBlocked, nameHint, nameProblem, providerOf, signInArgs, signInText } from "./account-logic.js";
import { ColourPicker, PoolsPicker, TagPicker } from "./account-sheet.js";
import { LoginBrowserField, readIdentity, useLoginBrowser } from "./reauth.js";
import { XtermBox } from "./terminal-sheet.js";

const STEPS: readonly TKey[] = ["accounts.add.stepProvider", "accounts.add.stepName", "accounts.add.stepSignIn", "accounts.add.stepUseIn"];
const TITLES: readonly TKey[] = ["accounts.add.titleProvider", "accounts.add.titleName", "accounts.add.titleSignIn", "accounts.add.titleUseIn"];

type SignIn = { state: "idle" } | { state: "pending"; run: number } | { state: "verified"; identity: string };

/** Add account wizard, a flyout like the account itself. Bundle `KP`. Step 3 runs `agent-switch add`
 *  in the built-in terminal; the account exists once it finishes. */
export function AddAccountDialog({ tool: initialTool }: { tool?: string }) {
  const s = useAS();
  const preset = ACCOUNT_TOOLS.find((x) => x === initialTool);
  const [step, setStep] = useState(preset ? 1 : 0);
  const [tool, setTool] = useState<Tool>(preset ?? "claude");
  const [name, setName] = useState("");
  const [label, setLabel] = useState<ProfileLabel | null>(null);
  const [picked, setPicked] = useState<IdentityColor | null>(null);
  const [pools, setPools] = useState<string[]>([]);
  const [method, setMethod] = useState<"browser" | "device">("browser");
  const [signIn, setSignIn] = useState<SignIn>({ state: "idle" });
  const [created, setCreated] = useState(false);
  const [runs, setRuns] = useState(0);
  const login = useLoginBrowser(tool);

  const provider = providerOf(tool);
  const color = picked ?? colorFor(`${tool}:${name}`);
  // Case-insensitive: on a default macOS / Windows disk `Work` and `work` are
  // the same profile folder, and the CLI refuses the second.
  const twin = s.accounts.find((a) => a.tool === tool && a.name.toLowerCase() === name.trim().toLowerCase());
  const taken = !!twin;
  const nameOk = ACCOUNT_NAME_RE.test(name) && (!taken || created);
  const problem = nameProblem(name);
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
      // The profile can exist with the sign-in unfinished; the next try then
      // signs that profile in instead of adding it a second time.
      if (r.exists) setCreated(true);
      if (r.exists && r.identity) setSignIn({ state: "verified", identity: r.identity });
      else {
        setSignIn({ state: "idle" });
        s.toast({ tone: "warn", text: t("accounts.add.unfinished") });
      }
    } catch (e) {
      setSignIn({ state: "idle" });
      s.toast({ tone: "alert", text: t("accounts.add.readFailed", { error: e instanceof Error ? e.message : String(e) }) });
    }
    void s.reload();
  }

  function done() {
    const id = `${tool}:${name}`;
    attempt(
      s,
      (async () => {
        if (label || picked) await s.act.updateAccount?.(id, { ...(label ? { label } : {}), ...(picked ? { color: picked } : {}) });
        for (const p of pools) await s.act.setPoolMembership?.(p, id, true);
      })(),
      t("accounts.add.finishFailed", { name }),
    );
    s.toast({ tone: "ok", text: t("accounts.add.added", { tool: TOOL_LABEL[tool], name }) });
    s.close();
  }

  const close = () => {
    s.close();
    if (created) void s.reload();
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && close()}
      kicker={t("accounts.add.kicker", { step: step + 1, total: STEPS.length })}
      title={t(TITLES[step])}
      width={480}
      footer={
        <>
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 2 && signIn.state === "pending"}>
              {t("common.back")}
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
              {t("accounts.add.continue")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={done}>
              <Check /> {t("common.done")}
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={t("accounts.add.steps")}>
        {STEPS.map((x, i) => (
          <li key={x} className="flex flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
            <span className={cn("h-1 rounded-full", i <= step ? "bg-ac-brand" : "bg-ac-line")} />
            <span className={cn("text-[11px]", i === step ? "text-ac-text" : "text-ac-faint")}>
              {i + 1}. {t(x)}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div role="radiogroup" aria-label={t("accounts.add.stepProvider")} className="grid gap-2 sm:grid-cols-2">
          {ACCOUNT_TOOLS.map((tl) => {
            const on = tool === tl;
            const n = s.accounts.filter((a) => a.tool === tl).length;
            return (
              <button
                key={tl}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTool(tl)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  on ? "border-transparent bg-ac-brand-tint shadow-[inset_0_0_0_1px_var(--ac-brand-line)]" : "border-ac-line hover:border-ac-line2",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-ac-text">{TOOL_LABEL[tl]}</span>
                  {tl === "antigravity" && <Badge>{t("accounts.add.monitorOnly")}</Badge>}
                </span>
                <span className="text-[11px] text-ac-muted">{n ? tp("accounts.add.soFar", n) : t("accounts.add.noAccountYet")}</span>
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
              {t("accounts.name.label")}
            </label>
            <TextInput
              id="new-name"
              mono
              autoFocus
              className="h-9"
              value={name}
              placeholder={t("accounts.add.namePlaceholder")}
              disabled={created}
              onChange={(e) => setName(e.target.value)}
            />
            <span className={cn("text-[11px]", (taken && !created) || problem ? "text-ac-warn-text" : "text-ac-faint")}>
              {taken && !created ? t("accounts.add.nameTaken", { tool: TOOL_LABEL[tool], name: twin?.name ?? name }) : (problem ?? nameHint())}
            </span>
          </div>
          <TagPicker value={label} onChange={setLabel} />
          <ColourPicker value={color} onChange={setPicked} />
          <PoolsPicker value={pools} onChange={setPools} />
        </div>
      )}

      {step === 2 && provider && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ac-soft">
            {t("accounts.add.signInIntro", { lead: signInText(tool) })}
          </p>
          <Segmented
            label={t("accounts.add.method")}
            value={method}
            onChange={setMethod}
            options={[
              { value: "browser", label: t("accounts.add.methodBrowser") },
              {
                value: "device",
                label: t("accounts.add.methodDevice"),
                disabled: true,
                why: tool === "codex" ? t("accounts.add.deviceNotWired") : t("accounts.add.deviceOnlyCodex"),
              },
            ]}
          />
          <LoginBrowserField tool={tool} login={login} />
          <Card className="flex items-center gap-3 p-3">
            <AccountDot color={color} size={12} />
            <span className="min-w-0 flex-1">
              <span className="block font-ac-mono text-xs text-ac-text">
                {TOOL_LABEL[tool]} · {name}
              </span>
              <span className="block text-[11px] text-ac-muted">
                {signIn.state === "idle" && t("accounts.add.notStarted")}
                {signIn.state === "pending" && t("accounts.add.waitingBrowser")}
                {signIn.state === "verified" && tx("accounts.add.verified", { identity: <Copyable text={signIn.identity} /> })}
              </span>
            </span>
            {signIn.state === "idle" && (
              <Button size="sm" variant="primary" onClick={begin}>
                <ExternalLink /> {t("accounts.add.openSignIn")}
              </Button>
            )}
            {signIn.state === "pending" && (
              <Button size="sm" disabled>
                <LoaderCircle className="animate-spin" /> {t("accounts.add.waiting")}
              </Button>
            )}
            {signIn.state === "verified" && (
              <Badge tone="ok" dot>
                {t("accounts.auth.connected")}
              </Badge>
            )}
          </Card>
          {signIn.state === "pending" && (
            <div className="flex h-[240px] overflow-hidden rounded-lg border border-ac-line bg-ac-bg p-3">
              <XtermBox key={signIn.run} args={signInArgs(provider, name, created, login.browser || undefined)} backend={tauriBackend} onExit={() => void finished()} />
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-ac-line p-3">
            <span>
              <span className="block text-[13px] text-ac-text">{TOOL_LABEL[tool]} CLI</span>
              <span className="block text-[11px] text-ac-muted">{t("accounts.add.plainPicks", { tool })}</span>
            </span>
            <Badge tone="ok">{t("accounts.add.always")}</Badge>
          </label>
          {tool !== "gemini" && s.platform === "mac" && (
            <p className="text-[11px] text-ac-muted">
              {t("accounts.add.dockHint", { tool: TOOL_LABEL[tool] })}
            </p>
          )}
          <p className="text-[11px] text-ac-faint">{t("accounts.add.protectionNote")}</p>
        </div>
      )}
    </Sheet>
  );
}

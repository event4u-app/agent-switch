import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, ShieldAlert } from "lucide-react";
import { t, tp, type TKey } from "../../i18n/index.js";
import { listBrowsers, listProfiles, type BrowserInfo } from "../../ipc.js";
import { getLoginBrowser, getLoginIsolated, setLoginBrowser, setLoginIsolated } from "../../settings-store.js";
import { tauriBackend } from "../../terminal.js";
import type { ProviderId } from "../../transforms.js";
import { AccountDot } from "../../ui/AccountDot.js";
import { Badge } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Card, DefinitionList } from "../../ui/Card.js";
import { Copyable } from "../../ui/CopyButton.js";
import { ago, expiry } from "../../ui/format.js";
import { Dialog } from "../../ui/Overlay.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Tool } from "../../vm/types.js";
import { providerOf, signInArgs, signInOutcome } from "./account-logic.js";
import { XtermBox } from "./terminal-sheet.js";

const SIGN_IN_WITH: Record<Tool, TKey> = {
  claude: "accounts.reauth.withClaude",
  codex: "accounts.reauth.withChatGpt",
  gemini: "accounts.reauth.withGoogle",
  antigravity: "accounts.reauth.withGoogle",
};

/** The identity `list` reports for one profile right now; null = none. */
export async function readIdentity(provider: ProviderId, name: string): Promise<{ exists: boolean; identity: string | null }> {
  const row = (await listProfiles()).find((r) => r.provider === provider && r.name === name);
  return { exists: !!row, identity: row?.identity ?? null };
}

type Step = "start" | "pending" | "verified" | "mismatch";

const DEFAULT_BROWSER = "default";

/** The installed browsers, once read; empty until then and where none apply. */
function useBrowsers(): BrowserInfo[] {
  const [list, setList] = useState<BrowserInfo[]>([]);
  useEffect(() => {
    let alive = true;
    listBrowsers().then(
      (l) => alive && setList(l),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export interface LoginBrowser {
  browsers: BrowserInfo[];
  /** Only Claude's sign-in follows a chosen browser. */
  choosable: boolean;
  /** "" = the default browser; a remembered one that is gone falls back to it. */
  browser: string;
  pick(id: string): void;
  /** The chosen browser can keep one profile per account. */
  canIsolate: boolean;
  /** The sign-in opens in the account's own browser profile. */
  isolated: boolean;
  setIsolated(on: boolean): void;
}

/** The browser a sign-in opens in, remembered across sign-ins. */
export function useLoginBrowser(tool: Tool): LoginBrowser {
  const browsers = useBrowsers();
  const [picked, setPicked] = useState(getLoginBrowser);
  const [isolatedPref, setIsolatedPref] = useState(getLoginIsolated);
  const choosable = tool === "claude" && browsers.length > 0;
  const browser = choosable && browsers.some((b) => b.id === picked) ? picked : "";
  const canIsolate = !!browser && browsers.some((b) => b.id === browser && b.isolatable);
  return {
    browsers,
    choosable,
    browser,
    pick: (id) => {
      setPicked(id);
      setLoginBrowser(id);
    },
    canIsolate,
    isolated: canIsolate && isolatedPref,
    setIsolated: (on) => {
      setIsolatedPref(on);
      setLoginIsolated(on);
    },
  };
}

export function LoginBrowserField({ tool, login }: { tool: Tool; login: LoginBrowser }) {
  return (
    <>
      {login.choosable && (
        <Select
          label={t("accounts.reauth.openIn")}
          value={login.browser || DEFAULT_BROWSER}
          onChange={(v) => login.pick(v === DEFAULT_BROWSER ? "" : v)}
          options={[{ value: DEFAULT_BROWSER, label: t("accounts.reauth.defaultBrowser") }, ...login.browsers.map((b) => ({ value: b.id, label: b.name }))]}
        />
      )}
      {login.choosable && login.canIsolate && (
        <label className="flex items-start justify-between gap-3 text-xs">
          <span>
            <span className="block text-ac-text">{t("accounts.reauth.ownProfile")}</span>
            <span className="block text-ac-muted">{t("accounts.reauth.ownProfileDetail")}</span>
          </span>
          <Switch checked={login.isolated} onChange={login.setIsolated} label={t("accounts.reauth.ownProfile")} />
        </label>
      )}
      {tool === "codex" && login.browsers.length > 0 && (
        <p className="text-xs text-ac-muted">
          {t("accounts.reauth.codexBrowser")}
        </p>
      )}
    </>
  );
}

/** Sign in / Sign in again. Bundle `DP` (dialog 540). The provider login runs in
 *  the built-in terminal; afterwards the identity is read again and compared. */
export function ReauthDialog({ accountId }: { accountId: string }) {
  const s = useAS();
  const a = s.accountById(accountId);
  const [step, setStep] = useState<Step>("start");
  const [run, setRun] = useState(0);
  const [seen, setSeen] = useState<string | null>(null);
  const login = useLoginBrowser(a?.tool ?? "claude");
  if (!a) return null;
  const shown = seen ?? a.identity;
  const browser = login.browser;
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
        s.toast({ tone: "warn", text: t("accounts.reauth.unfinished") });
      } else setStep(outcome);
    } catch (e) {
      setStep("start");
      s.toast({ tone: "alert", text: t("accounts.reauth.readFailed", { error: e instanceof Error ? e.message : String(e) }) });
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
      kicker={first ? t("accounts.action.signIn") : t("accounts.action.signInAgain")}
      title={
        <span className="inline-flex items-center gap-2.5">
          <AccountDot color={a.color} size={12} /> {TOOL_LABEL[a.tool]} · {a.name}
        </span>
      }
      width={540}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close}>
            {t("accounts.action.later")}
          </Button>
          <span className="flex-1" />
          {step === "start" && (
            <Button
              size="sm"
              variant="primary"
              disabled={!provider}
              title={provider ? undefined : t("accounts.reauth.noBackend", { tool: TOOL_LABEL[a.tool] })}
              onClick={() => {
                setRun((n) => n + 1);
                setStep("pending");
              }}
            >
              <ExternalLink /> {t(SIGN_IN_WITH[a.tool])}
            </Button>
          )}
          {step === "pending" && (
            <Button size="sm" disabled>
              <LoaderCircle className="animate-spin" /> {t("accounts.reauth.waitingBrowser")}
            </Button>
          )}
          {step === "verified" && (
            <Button size="sm" variant="primary" onClick={close}>
              {waiting.length ? tp("accounts.reauth.doneContinue", waiting.length) : t("common.done")}
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
              <ExternalLink /> {t("accounts.action.tryAgain")}
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
            <p className="text-[13px] text-ac-soft">{t("accounts.reauth.intro", { tool: TOOL_LABEL[a.tool] })}</p>
            <DefinitionList
              rows={[
                [t("accounts.reauth.expected"), a.identity ? <Copyable text={a.identity} /> : t("accounts.reauth.anyFirst")],
                [t("accounts.lastRefresh"), a.auth?.lastRefreshAt ? ago(a.auth.lastRefreshAt, s.now) : "—"],
                [t("accounts.reauth.waitingSessions"), waiting.length ? waiting.map((x) => x.project).join(", ") : t("accounts.reauth.none")],
              ]}
            />
            <LoginBrowserField tool={a.tool} login={login} />
          </>
        )}
        {step === "pending" && provider && (
          <>
            <p className="text-[13px] text-ac-soft">{t("accounts.reauth.finishInBrowser")}</p>
            <div className="flex h-[280px] overflow-hidden rounded-lg border border-ac-line bg-ac-bg p-3">
              <XtermBox key={run} args={signInArgs(provider, a.name, true, browser || undefined, login.isolated)} backend={tauriBackend} onExit={(code) => void finished(code)} />
            </div>
          </>
        )}
        {step === "verified" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="ok" dot>
                {t("accounts.auth.connected")}
              </Badge>
              {shown && <Copyable text={shown} className="text-[13px] text-ac-text" />}
            </div>
            <p className="text-xs text-ac-muted">
              {[
                before ? t("accounts.reauth.sameAccount") : "",
                a.auth?.expiresAt ? t("accounts.reauth.runsUntil", { when: expiry(a.auth.expiresAt, s.now) }) : "",
                waiting.length ? t("accounts.reauth.pausedContinue") : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          </div>
        )}
        {step === "mismatch" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="alert" dot>
                {t("accounts.state.wrongAccount")}
              </Badge>
              {seen && <Copyable text={seen} className="text-[13px] text-ac-text" />}
            </div>
            <p className="text-xs text-ac-muted">{t("accounts.reauth.mismatch", { who: a.identity ?? t("accounts.reauth.wantedAccount") })}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

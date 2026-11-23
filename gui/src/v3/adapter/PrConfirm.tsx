/** The Create PR confirm's body: the commit and where the push writes it, the
 *  base (any branch on the base remote; picking one re-reads the plan for it)
 *  and the title. What it last showed is kept in `state`, which the confirm
 *  sends back, so the CLI can refuse when anything changed since. */
import { useRef, useState } from "react";

import type { PrPlanJson } from "../../ipc.js";
import { Select } from "../../ui/Select.js";
import { TextInput } from "../../ui/TextInput.js";

export interface PrConfirmState {
  plan: PrPlanJson;
  title: string;
}

export function PrConfirm({ initial, state, replan }: { initial: PrPlanJson; state: PrConfirmState; replan: (base: string) => Promise<PrPlanJson> }) {
  const [plan, setPlan] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edited = useRef(false);
  const seq = useRef(0);

  const show = (p: PrPlanJson) => {
    setPlan(p);
    state.plan = p;
    if (!edited.current) {
      setTitle(p.title);
      state.title = p.title;
    }
  };
  const pickBase = (base: string) => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    // Until the plan for the new base is back, confirming must not send the old one.
    state.plan = { ...plan, base, problem: { message: `the plan for ${base} is still being read`, fix: "wait a moment, then confirm" } };
    replan(base).then(
      (p) => n === seq.current && (show(p), setLoading(false)),
      (e: unknown) => {
        if (n !== seq.current) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setLoading(false);
        state.plan = { ...plan, base, problem: { message, fix: "pick another base" } };
      },
    );
  };

  const bases = plan.base && !plan.bases.includes(plan.base) ? [...plan.bases, plan.base].sort() : plan.bases;
  const n = plan.ahead ?? 0;
  const problem = error ?? (plan.problem ? `${plan.problem.message} — ${plan.problem.fix}` : null);
  return (
    <div className="flex flex-col gap-3 text-[13px] text-ac-soft">
      <p className="[text-wrap:pretty]">
        Pushes <span className="font-ac-mono text-ac-text">{plan.head?.slice(0, 7)}</span> ({plan.branch}, {n} commit{n === 1 ? "" : "s"}) to {plan.remote} as <span className="font-ac-mono text-ac-text">{plan.ref}</span>
        {plan.setsUpstream ? " (sets its upstream)" : ""}
        {plan.pushUrl ? (
          <>
            {" "}at <span className="font-ac-mono text-ac-text">{plan.pushUrl}</span>
          </>
        ) : null}
        , then opens a pull request{plan.repo ? (
          <>
            {" "}in <span className="font-ac-mono text-ac-text">{plan.repo}</span>
          </>
        ) : null}{" "}
        with gh.
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ac-muted">Into, on {plan.baseRemote}</span>
        <Select ariaLabel="Base branch" value={plan.base ?? ""} disabled={loading} onChange={pickBase} options={bases.map((b) => ({ value: b, label: b }))} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ac-muted">Title</span>
        <TextInput
          aria-label="PR title"
          className="w-full text-[13px]"
          value={title}
          maxLength={200}
          onChange={(e) => {
            edited.current = true;
            setTitle(e.target.value);
            state.title = e.target.value;
          }}
        />
      </label>
      {plan.uncommitted > 0 && (
        <p>
          {plan.uncommitted} uncommitted {plan.uncommitted === 1 ? "file stays" : "files stay"} out of it.
        </p>
      )}
      {problem && (
        <p role="alert" className="text-ac-alert-text">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * One-click Next Steps (S8, ADR-0006): parses the report's "Recommended Next Steps" into
 * steering buttons. Each sends a templated `user-message` turn carrying the step text + the
 * run's baseline metric (from the Scorecard's metrics artifact, when present) so Clair has
 * context. Steering shortcuts — not an auto-landing promise. Renders nothing when the report
 * has no Next Steps section.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import { useRunContext } from "../store/RunContext";
import { selectMetrics } from "../store/selectors";
import { parseMetrics } from "../lib/metrics";
import { parseNextSteps } from "../lib/nextSteps";

export function NextSteps({ reportMarkdown }: { reportMarkdown: string }) {
  const { store, sendMessage } = useRunContext();
  const metricsArtifact = useStore(store, (s) => selectMetrics(s.session));
  const steps = useMemo(() => parseNextSteps(reportMarkdown), [reportMarkdown]);

  if (steps.length === 0) return null;

  const baseline = (() => {
    const m = metricsArtifact ? parseMetrics(metricsArtifact.meta) : null;
    const top = m?.scores[0];
    return top ? `${top.label} ${top.value.toFixed(3)}` : null;
  })();

  const send = (step: string) => {
    const ctx = baseline ? ` The current solution's baseline is ${baseline}.` : "";
    sendMessage(
      `Apply this recommended next step from the AutoML report: "${step}".${ctx} ` +
        `Treat it as a new refinement turn on the current solution.`,
    );
  };

  return (
    <div className="next-steps" data-testid="next-steps">
      <div className="next-steps-title">Next steps (from the report)</div>
      <div className="next-steps-buttons">
        {steps.map((step, i) => (
          <button key={i} type="button" className="next-step" title={step} onClick={() => send(step)}>
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

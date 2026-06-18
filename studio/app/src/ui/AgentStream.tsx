/**
 * The agent stream zone (ADR-0006): token text, collapsible tool-call cards
 * (collapsed by default — progressive disclosure), and inline Gate prompts for
 * human-in-the-loop (ADR-0010).
 */
import type { Gate, ToolCall } from "../daemon/protocol";

function ToolCallCard({ call }: { call: ToolCall }) {
  return (
    <details className="toolcall">
      <summary>
        <span className="tc-kind">{call.kind}</span>
        <span className="tc-title">{call.title}</span>
        {call.status === "running" && <span className="tc-spin">●</span>}
        {call.score && <span className="tc-score">{call.score}</span>}
      </summary>
      <div className="tc-body">
        {call.code && <pre>{call.code}</pre>}
        {call.output && <pre>{call.output}</pre>}
      </div>
    </details>
  );
}

function GateCard({ gate, onResolve }: { gate: Gate; onResolve: (id: string) => void }) {
  const options = gate.question?.options;
  return (
    <div className="gate">
      <div className="gate-kind">
        {gate.kind === "clarify" ? "Needs your input" : gate.kind === "approval" ? "Approval needed" : "Plan"}
      </div>
      <div className="gate-prompt">{gate.question?.prompt ?? gate.prompt}</div>
      <div className="gate-options">
        {options
          ? options.map((opt, i) => (
              <button
                key={opt}
                className={i === 0 ? "primary" : ""}
                onClick={() => onResolve(gate.id)}
              >
                {opt}
              </button>
            ))
          : (
            <button className="primary" onClick={() => onResolve(gate.id)}>
              {gate.kind === "approval" ? "Approve & continue" : "Continue"}
            </button>
          )}
      </div>
    </div>
  );
}

export function AgentStream({
  agentText,
  toolCalls,
  openGates,
  onResolveGate,
}: {
  agentText: string;
  toolCalls: ToolCall[];
  openGates: Gate[];
  onResolveGate: (gateId: string) => void;
}) {
  return (
    <div className="zone stream">
      <div className="zone-title">Agent · Clair</div>
      <div className="stream-body">
        {agentText && <div className="agent-text">{agentText}</div>}
        {toolCalls.map((c) => <ToolCallCard key={c.id} call={c} />)}
      </div>
      {openGates.map((g) => <GateCard key={g.id} gate={g} onResolve={onResolveGate} />)}
    </div>
  );
}

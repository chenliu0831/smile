/**
 * The agent zone (ADR-0006): a turn-based conversation transcript (user vs agent
 * turns), collapsible tool-call cards per agent turn (progressive disclosure), inline
 * clarify/approval gates (ADR-0010), and a chat input. This is the interactive spine —
 * a Cursor/Claude-Code-style prompting experience.
 */
import { useEffect, useRef, useState } from "react";
import type { ChatTurn, Gate, ToolCall } from "../daemon/protocol";

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

function TurnView({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="turn user">
        <div className="turn-role">You</div>
        <div className="turn-text">{turn.text}</div>
      </div>
    );
  }
  return (
    <div className="turn agent">
      <div className="turn-role">Clair</div>
      {turn.toolCalls.map((c) => <ToolCallCard key={c.id} call={c} />)}
      {turn.text && <div className="turn-text agent-text">{turn.text}</div>}
      {turn.status === "streaming" && !turn.text && <div className="turn-thinking">Thinking…</div>}
    </div>
  );
}

function GateCard({
  gate,
  onResolve,
  onApprove,
}: {
  gate: Gate;
  onResolve: (id: string, answer: string) => void;
  onApprove: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const options = gate.question?.options;
  const isClarify = gate.kind === "clarify";
  return (
    <div className="gate">
      <div className="gate-kind">
        {isClarify ? "Needs your input" : gate.kind === "approval" ? "Approval needed" : "Plan"}
      </div>
      <div className="gate-prompt">{gate.question?.prompt ?? gate.prompt}</div>
      <div className="gate-options">
        {isClarify && options && options.length > 0 ? (
          options.map((opt, i) => (
            <button key={opt} className={i === 0 ? "primary" : ""} onClick={() => onResolve(gate.id, opt)}>
              {opt}
            </button>
          ))
        ) : isClarify ? (
          <form
            className="gate-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onResolve(gate.id, text.trim());
            }}
          >
            <input
              autoFocus
              value={text}
              placeholder="Type your answer…"
              onChange={(e) => setText(e.target.value)}
            />
            <button className="primary" type="submit" disabled={!text.trim()}>Send</button>
          </form>
        ) : (
          <button className="primary" onClick={() => onApprove(gate.id)}>Approve &amp; continue</button>
        )}
      </div>
    </div>
  );
}

export function AgentStream({
  turns,
  openGates,
  streaming,
  onSend,
  onResolveGate,
  onApproveGate,
  onCancel,
}: {
  turns: ChatTurn[];
  openGates: Gate[];
  streaming: boolean;
  onSend: (text: string) => void;
  onResolveGate: (gateId: string, answer: string) => void;
  onApproveGate: (gateId: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest turn as the conversation grows.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, openGates]);

  const blocked = streaming || openGates.length > 0;

  function submit() {
    const t = draft.trim();
    if (!t || blocked) return;
    onSend(t);
    setDraft("");
  }

  return (
    <div className="zone stream">
      <div className="zone-title">Agent · Clair</div>
      <div className="stream-body" ref={bodyRef}>
        {turns.length === 0 && (
          <div className="stream-empty">Ask Clair to analyze a dataset to begin.</div>
        )}
        {turns.map((t) => <TurnView key={t.id} turn={t} />)}
        {openGates.map((g) => (
          <GateCard key={g.id} gate={g} onResolve={onResolveGate} onApprove={onApproveGate} />
        ))}
      </div>
      <div className="chat-input">
        <textarea
          rows={2}
          value={draft}
          placeholder={blocked ? "Clair is working…" : "Message Clair…  (Enter to send)"}
          disabled={blocked}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button className="chat-stop" onClick={onCancel} title="Stop">■</button>
        ) : (
          <button className="chat-send primary" onClick={submit} disabled={!draft.trim() || blocked}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

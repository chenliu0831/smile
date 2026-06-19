/**
 * The agent zone (ADR-0006): a turn-based conversation transcript (user vs agent
 * turns), collapsible tool-call cards per agent turn (progressive disclosure), inline
 * clarify/approval gates (ADR-0010), and a chat input. This is the interactive spine —
 * a Cursor/Claude-Code-style prompting experience.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatTurn, Gate, Todo, ToolCall } from "../daemon/protocol";
import { TodoChecklist } from "./TodoChecklist";

/** Glyph per tool kind (R2), so cards are scannable at a glance. */
const KIND_ICON: Record<string, string> = {
  shell: "❯_",
  read: "▤",
  write: "✎",
  dataviz: "▦",
  skill: "✦",
  script: "λ",
  sql: "⌗",
};

function ToolCallCard({ call, onOpenSql }: { call: ToolCall; onOpenSql?: (sql: string) => void }) {
  // SQL cards are first-class and editable: the user can drop the agent's statement
  // straight into the SQL console (Count-style "no black boxes").
  const canOpen = call.kind === "sql" && !!call.code && !!onOpenSql;
  return (
    <details className="toolcall">
      <summary>
        <span className={`tc-kind kind-${call.kind}`}>
          <span className="tc-icon">{KIND_ICON[call.kind] ?? "λ"}</span>
          {call.kind}
        </span>
        <span className="tc-title">{call.title}</span>
        {call.status === "running" && <span className="tc-spin">●</span>}
        {call.status === "failed" && <span className="tc-fail">failed</span>}
        {call.score && <span className="tc-score">{call.score}</span>}
      </summary>
      <div className="tc-body">
        {call.code && <pre>{call.code}</pre>}
        {canOpen && (
          <button
            className="tc-open-sql"
            onClick={() => onOpenSql!(call.code!)}
          >
            Open in console →
          </button>
        )}
        {call.output && <pre>{call.output}</pre>}
      </div>
    </details>
  );
}

function TurnView({ turn, onOpenSql }: { turn: ChatTurn; onOpenSql?: (sql: string) => void }) {
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
      {turn.toolCalls.map((c) => <ToolCallCard key={c.id} call={c} onOpenSql={onOpenSql} />)}
      {turn.text && <div className="turn-text agent-text">{turn.text}</div>}
      {turn.status === "streaming" && !turn.text && <div className="turn-thinking">Thinking…</div>}
      {turn.status === "failed" && <div className="turn-failed">⚠ This turn failed.</div>}
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const options = gate.question?.options;
  const isClarify = gate.kind === "clarify";
  const multi = !!gate.question?.multiSelect;
  // R3: show the agent's question header (e.g. "Primary metric") when present.
  const label = gate.question?.header
    ? gate.question.header
    : isClarify ? "Needs your input" : gate.kind === "approval" ? "Approval needed" : "Plan";

  function toggle(opt: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      return next;
    });
  }

  return (
    <div className="gate">
      <div className="gate-kind">{label}</div>
      <div className="gate-prompt">{gate.question?.prompt ?? gate.prompt}</div>
      <div className="gate-options">
        {isClarify && options && options.length > 0 && multi ? (
          // R3 multi-select: checkboxes + Submit; aggregate picks into one answer.
          <div className="gate-multi">
            {options.map((opt) => (
              <label key={opt} className={`gate-check ${picked.has(opt) ? "on" : ""}`}>
                <input type="checkbox" checked={picked.has(opt)} onChange={() => toggle(opt)} />
                {opt}
              </label>
            ))}
            <button
              className="primary"
              disabled={picked.size === 0}
              onClick={() => onResolve(gate.id, [...picked].join(", "))}
            >
              Submit
            </button>
          </div>
        ) : isClarify && options && options.length > 0 ? (
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
  todos,
  openGates,
  streaming,
  welcome,
  onSend,
  onResolveGate,
  onApproveGate,
  onCancel,
  onOpenSql,
}: {
  turns: ChatTurn[];
  todos: Todo[];
  openGates: Gate[];
  streaming: boolean;
  /** Cold-start hero shown when there are no turns yet (revamp). */
  welcome?: ReactNode;
  onSend: (text: string) => void;
  onResolveGate: (gateId: string, answer: string) => void;
  onApproveGate: (gateId: string) => void;
  onCancel: () => void;
  /** Open an agent SQL statement in the SQL console (sql tool cards). */
  onOpenSql?: (sql: string) => void;
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
      <TodoChecklist todos={todos} />
      <div className="stream-body" ref={bodyRef}>
        {turns.length === 0 &&
          (welcome ?? <div className="stream-empty">Ask Clair to analyze a dataset to begin.</div>)}
        {turns.map((t) => <TurnView key={t.id} turn={t} onOpenSql={onOpenSql} />)}
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

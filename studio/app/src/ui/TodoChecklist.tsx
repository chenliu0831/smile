/**
 * The agent's live task plan (R1) — a pinned, in-place-updating checklist mirroring the
 * agent's TodoWrite calls. Turns an opaque stream of tool spinners into a legible plan:
 * the user sees what the agent intends and watches it tick off. Read-only (transparency,
 * not control), pinned above the conversation transcript.
 */
import type { Todo } from "../daemon/protocol";

function marker(status: string) {
  if (status === "completed") return <span className="todo-mark done">✓</span>;
  if (status === "in_progress") return <span className="todo-mark active">●</span>;
  return <span className="todo-mark pending" />;
}

export function TodoChecklist({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;

  return (
    <details className="todo-panel" open>
      <summary>
        <span className="todo-title">Plan</span>
        <span className="todo-count">{done}/{todos.length}</span>
      </summary>
      <ul className="todo-list">
        {todos.map((t, i) => (
          <li key={i} className={`todo-row ${t.status}`}>
            {marker(t.status)}
            <span className="todo-text">
              {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

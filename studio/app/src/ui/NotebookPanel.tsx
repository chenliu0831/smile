/**
 * Notebook escape hatch (ADR-0008): a peer surface to the Agent Surface that
 * shares the same kernel and working directory. Stub for now — a single faux
 * cell input and an empty state explaining the shared-kernel contract.
 */
export function NotebookPanel() {
  return (
    <div className="surface notebook">
      <div className="surface-note">
        Peer surface to the Agent Surface — shares the same kernel and working
        directory. Agent-generated cells land here as durable, editable
        artifacts.
      </div>
      <div className="nb-cell">
        <div className="nb-gutter">[ ]</div>
        <div
          className="nb-input"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="# write Python here — runs in the shared kernel"
        />
      </div>
      <div className="surface-empty">No cells yet.</div>
    </div>
  );
}

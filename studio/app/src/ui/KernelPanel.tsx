/**
 * Kernel Explorer (ADR-0008): the bridge between the two model-production
 * paths. Stub tree with the three groups it will host — DataFrames, Models
 * (the JVM `.sml` path), and Services — each with an empty state for now.
 */
const GROUPS = [
  { label: "DataFrames", hint: "No frames in the kernel yet." },
  { label: "Models", hint: "No trained .sml models yet." },
  { label: "Services", hint: "No serving endpoints yet." },
] as const;

export function KernelPanel() {
  return (
    <div className="surface kernel">
      <div className="surface-note">
        Live view of the shared kernel — the bridge from kernel variables to the
        deployable JVM model path.
      </div>
      <ul className="kx-tree">
        {GROUPS.map((g) => (
          <li key={g.label} className="kx-group">
            <div className="kx-group-label">{g.label}</div>
            <div className="kx-empty">{g.hint}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Dataset loading (P2): open a native file picker, copy the chosen file into a fresh
 * session working dir's input/ via the Shell, and return the working dir so the caller
 * can (re)start the daemon there. The agent's skills read ./input/<file> (ADR-0005),
 * so no skill change is needed. Outside Tauri (browser dev) this is unavailable.
 */
export interface LoadedDataset {
  workingDir: string;
  fileName: string;
  sizeBytes: number;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Whether dataset loading is available (only inside the Tauri shell). */
export function canLoadDataset(): boolean {
  return inTauri();
}

/** Open the native file picker for a dataset; returns the chosen absolute path, or null. */
export async function pickDatasetFile(): Promise<string | null> {
  if (!inTauri()) throw new Error("Dataset loading requires the desktop app.");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Import a dataset",
    filters: [
      { name: "Data files", extensions: ["csv", "tsv", "json", "parquet"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

/** The SQL identifier a file imports as (file stem, sanitized to a safe table name). */
export function tableNameForPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(safe) ? safe : `t_${safe}`;
}

/**
 * The DuckDB reader expression for a chosen file, by extension — imports the file directly
 * into the shared session via /sql, no copy and no daemon restart (fast).
 */
export function readerForPath(path: string): string {
  const lower = path.toLowerCase();
  const lit = `'${path.replace(/'/g, "''")}'`;
  if (lower.endsWith(".parquet")) return `read_parquet(${lit})`;
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) return `read_json(${lit})`;
  if (lower.endsWith(".tsv")) return `read_csv(${lit}, delim='\\t', header=true)`;
  return `read_csv(${lit}, header=true)`;
}

/**
 * Prompt for a dataset file and stage it for the agent (LEGACY heavy path: copies the file
 * into a fresh session input/ dir and RESTARTS the daemon there). Kept for the cold-start
 * "Load Dataset" flow; the in-session fast path is importDataset in the controller.
 * Returns the loaded dataset, or null if the user cancelled.
 */
export async function pickAndLoadDataset(): Promise<LoadedDataset | null> {
  if (!inTauri()) throw new Error("Dataset loading requires the desktop app.");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const selected = await open({
    multiple: false,
    directory: false,
    title: "Load a dataset",
    filters: [
      { name: "Data files", extensions: ["csv", "tsv", "arff", "json", "parquet", "avro", "xlsx"] },
    ],
  });
  if (!selected || typeof selected !== "string") return null;

  const result = await invoke<{ working_dir: string; file_name: string; size_bytes: number }>(
    "load_dataset",
    { sourcePath: selected },
  );
  return {
    workingDir: result.working_dir,
    fileName: result.file_name,
    sizeBytes: result.size_bytes,
  };
}

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

/**
 * Prompt for a dataset file and stage it for the agent. Returns the loaded dataset,
 * or null if the user cancelled.
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

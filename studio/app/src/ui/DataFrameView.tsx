/**
 * Renders a `dataframe` artifact: the data as a table (Perspective Data Grid) + its source
 * path, and — where the rows are a labelled binary prediction set — Predictions Studio
 * (ROC/confusion) ABOVE the grid. The rows are fetched ONCE here (useDataframe) and shared by
 * both surfaces, so the shared DuckDB connection is hit a single time per artifact.
 *
 * This is the "always show the data as a table, with its path" surface for every run CSV that
 * lacks a dedicated interactive view (the Leaderboard owns its own).
 */
import type { Artifact } from "../daemon/protocol";
import { DataGrid } from "./DataGrid";
import { PredictionsStudio } from "./PredictionsStudio";
import { useDataframe } from "./useDataframe";
import { columnTableToGrid } from "../lib/dataFrame";

export function DataFrameView({ artifact, height = 360 }: { artifact: Artifact; height?: number }) {
  const state = useDataframe(artifact.data?.ref);
  const table = state.status === "ready" ? state.table : undefined;
  const grid = table ? columnTableToGrid(table) : undefined;

  return (
    <div className="dataframe-view" data-testid="dataframe-view">
      {/* Native chart view above the grid, only when the rows form a prediction set. */}
      <PredictionsStudio table={table} />
      {grid && grid.rows.length > 0 ? (
        <DataGrid data={grid} height={height} />
      ) : (
        <div className="canvas-empty">
          {state.status === "failed" ? "Could not load the table for this artifact." : "Loading table…"}
        </div>
      )}
      <ArtifactPath artifact={artifact} />
    </div>
  );
}

/** The source-file path footer, shown beneath a data artifact. */
export function ArtifactPath({ artifact }: { artifact: Artifact }) {
  if (!artifact.path) return null;
  return (
    <div className="artifact-path" data-testid="artifact-path">
      <span className="artifact-path-label">source</span>
      <code className="artifact-path-value">{artifact.path}</code>
    </div>
  );
}

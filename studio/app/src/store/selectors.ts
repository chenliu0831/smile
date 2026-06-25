/**
 * Derived selectors — the single home for facts the components used to re-derive in many
 * places (the architecture review's C6). Each is a pure function of the relevant state, so
 * it's unit-testable without React and defined once rather than inlined per component.
 *
 * They take the minimal inputs they need (not the whole store), so they compose equally from
 * a `RunStore` snapshot or the reactive fields the `RunController` already exposes — callers
 * stay subscribed through the controller; these add no out-of-band store reads.
 */
import type { Artifact, StageProgress } from "../daemon/protocol";
import type { RunState } from "./runState";
import type { LoadedDataset } from "../daemon/dataset";
import type { DatasetInfo } from "../daemon/datasetInfo";

/** The chat is busy (a turn is streaming or a gate is open) — input must be disabled. */
export const selectIsBusy = (session: RunState): boolean =>
  session.streaming || session.openGates.length > 0;

/**
 * The authoritative dataset name: prefer the daemon's detected dataset (real dimensions,
 * reflects what the agent analyzes), fall back to the in-app loaded file, else null.
 */
export const selectDatasetName = (
  datasetInfo: DatasetInfo | null,
  dataset: LoadedDataset | null,
): string | null => datasetInfo?.fileName ?? dataset?.fileName ?? null;

/** True once any dataset is in scope (daemon-detected or locally loaded). */
export const selectHasDataset = (
  datasetInfo: DatasetInfo | null,
  dataset: LoadedDataset | null,
): boolean => !!datasetInfo || !!dataset;

/**
 * The leaderboard artifact, matched by KIND not ref: the real daemon emits it under ref
 * "candidates" (the stage id); only the mock uses ref "leaderboard". Keying on ref left the
 * Leaderboard view permanently disabled on real runs.
 */
export const selectLeaderboard = (session: RunState): Artifact | undefined =>
  Object.values(session.artifacts).find((a) => a.kind === "leaderboard");

/** The metrics artifact (Scorecard source): kind "metrics", ref "metrics". Carries
 * final_metrics.json JSON in `meta` (ADR-0011/0014). */
export const selectMetrics = (session: RunState): Artifact | undefined =>
  Object.values(session.artifacts).find((a) => a.kind === "metrics" && a.ref === "metrics");

/** The tuned-hyperparameters companion (kind "metrics", ref "params"): best_params.json
 * JSON in `meta`, joined into the Leaderboard rows (S7). */
export const selectParams = (session: RunState): Artifact | undefined =>
  Object.values(session.artifacts).find((a) => a.kind === "metrics" && a.ref === "params");

/** The diagnostics artifact (Driver Diagnostics source), matched by KIND. Carries the
 * permutation-importance array in `meta`; used to enrich the Ask-Clair-about-column prompt
 * with a driver rank when present (S8 soft enhancement). */
export const selectDiagnostics = (session: RunState): Artifact | undefined =>
  Object.values(session.artifacts).find((a) => a.kind === "diagnostics");

/** A stage that has produced at least one artifact resolvable in the store. */
const stageHasArtifacts = (session: RunState, stage: StageProgress): boolean =>
  stage.artifactRefs.some((ref) => !!session.artifacts[ref]);

/**
 * Auto-follow target (ADR-0017): the stageId the cockpit should select as a Run streams, or
 * null when there's nothing to follow (no stage has produced artifacts yet). A pure function
 * of session state so the "which stage" decision is unit-testable without React or timers;
 * the `userPicked` latch and the actual view/selection writes live in Workspace.
 *
 * - While the Run streams, follow the LATEST (highest-index) stage that has resolvable
 *   artifacts — "the right step when its artifacts show up". Stage order is the timeline
 *   order the daemon seeded; later in the array = later in the pipeline.
 * - When the Run has finished, rest on the latest stage whose artifact is a `report` (the
 *   final report is the natural resting place), matched by KIND not stageId — consistent
 *   with selectLeaderboard. Falls back to the latest stage-with-artifacts if no report stage.
 */
export const selectAutoFollow = (session: RunState): string | null => {
  const withArtifacts = session.stages.filter((s) => stageHasArtifacts(session, s));
  if (withArtifacts.length === 0) return null;

  const isLive = session.status === "running";
  if (!isLive) {
    const reportStages = withArtifacts.filter((s) =>
      s.artifactRefs.some((ref) => session.artifacts[ref]?.kind === "report"),
    );
    if (reportStages.length > 0) return reportStages[reportStages.length - 1].stageId;
  }
  return withArtifacts[withArtifacts.length - 1].stageId;
};

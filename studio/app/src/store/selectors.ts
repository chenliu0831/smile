/**
 * Derived selectors — the single home for facts the components used to re-derive in many
 * places (the architecture review's C6). Each is a pure function of the relevant state, so
 * it's unit-testable without React and defined once rather than inlined per component.
 *
 * They take the minimal inputs they need (not the whole store), so they compose equally from
 * a `RunStore` snapshot or the reactive fields the `RunController` already exposes — callers
 * stay subscribed through the controller; these add no out-of-band store reads.
 */
import type { Artifact } from "../daemon/protocol";
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

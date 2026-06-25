import { describe, it, expect } from "vitest";
import {
  selectIsBusy,
  selectDatasetName,
  selectHasDataset,
  selectLeaderboard,
  selectAutoFollow,
} from "./selectors";
import { initialRunState, type RunState } from "./runState";
import type { Artifact, StageProgress } from "../daemon/protocol";
import type { LoadedDataset } from "../daemon/dataset";
import type { DatasetInfo } from "../daemon/datasetInfo";

const session = (over: Partial<RunState> = {}): RunState => ({ ...initialRunState, ...over });

describe("selectIsBusy", () => {
  it("is true while streaming", () => {
    expect(selectIsBusy(session({ streaming: true }))).toBe(true);
  });
  it("is true while a gate is open", () => {
    expect(selectIsBusy(session({ openGates: [{ id: "g", kind: "clarify", prompt: "?" }] }))).toBe(true);
  });
  it("is false when idle with no gates", () => {
    expect(selectIsBusy(session())).toBe(false);
  });
});

describe("selectDatasetName / selectHasDataset", () => {
  const info: DatasetInfo = { fileName: "titanic.csv", nrow: 891, ncol: 12, columns: [], preview: {} };
  const loaded: LoadedDataset = { workingDir: "/x", fileName: "local.csv", sizeBytes: 10 };

  it("prefers the daemon-detected dataset name over the locally loaded one", () => {
    expect(selectDatasetName(info, loaded)).toBe("titanic.csv");
  });
  it("falls back to the loaded file when there's no daemon info", () => {
    expect(selectDatasetName(null, loaded)).toBe("local.csv");
  });
  it("is null when neither is present", () => {
    expect(selectDatasetName(null, null)).toBeNull();
    expect(selectHasDataset(null, null)).toBe(false);
  });
  it("hasDataset is true if either is present", () => {
    expect(selectHasDataset(info, null)).toBe(true);
    expect(selectHasDataset(null, loaded)).toBe(true);
  });
});

describe("selectLeaderboard", () => {
  it("finds the artifact by kind, regardless of ref", () => {
    const lb: Artifact = { ref: "candidates", kind: "leaderboard", title: "Leaderboard" };
    const other: Artifact = { ref: "eda", kind: "report", title: "EDA" };
    const s = session({ artifacts: { candidates: lb, eda: other } });
    expect(selectLeaderboard(s)).toBe(lb);
  });
  it("is undefined when there's no leaderboard artifact", () => {
    expect(selectLeaderboard(session())).toBeUndefined();
  });
});

describe("selectAutoFollow", () => {
  // Helpers mirroring the real daemon: artifactRefs[i] === stageId, artifact keyed by ref.
  const stage = (id: string, refs: string[] = [id]): StageProgress =>
    ({ stageId: id, label: id, status: "done", artifactRefs: refs });
  const art = (ref: string, kind: Artifact["kind"]): Artifact => ({ ref, kind, title: ref });

  it("is null when no stage has produced a resolvable artifact yet", () => {
    // Stages seeded but no artifacts in the store, and a stage whose refs don't resolve.
    const s = session({
      status: "running",
      stages: [stage("eda"), stage("preprocess")],
      artifacts: {},
    });
    expect(selectAutoFollow(s)).toBeNull();
  });

  it("follows the latest stage that has resolvable artifacts during a live run", () => {
    const s = session({
      status: "running",
      stages: [stage("eda"), stage("preprocess"), stage("features"), stage("candidates")],
      // eda + features have landed; preprocess + candidates have not.
      artifacts: { eda: art("eda", "report"), features: art("features", "dataframe") },
    });
    // Latest stage WITH artifacts is "features" (index 2), not "candidates" (no artifact yet).
    expect(selectAutoFollow(s)).toBe("features");
  });

  it("ignores a stage whose artifactRefs don't resolve in the store (running, empty)", () => {
    const s = session({
      status: "running",
      stages: [stage("eda"), stage("candidates", ["candidates"])],
      artifacts: { eda: art("eda", "report") }, // candidates ref unresolved
    });
    expect(selectAutoFollow(s)).toBe("eda");
  });

  it("rests on the latest report-kind stage when the run has finished", () => {
    const s = session({
      status: "completed",
      stages: [stage("eda"), stage("candidates"), stage("report"), stage("submission")],
      artifacts: {
        eda: art("eda", "report"),
        candidates: art("candidates", "leaderboard"),
        report: art("report", "report"),
        submission: art("submission", "dataframe"),
      },
    });
    // Latest stage-with-artifacts is "submission", but on FINISH we rest on the final report.
    expect(selectAutoFollow(s)).toBe("report");
  });

  it("falls back to the latest stage-with-artifacts on finish when NO stage is report-kind", () => {
    const s = session({
      status: "completed",
      stages: [stage("candidates"), stage("submission")],
      artifacts: {
        candidates: art("candidates", "leaderboard"),
        submission: art("submission", "dataframe"),
      },
    });
    // No report-kind stage exists, so rest on the latest stage that produced artifacts.
    expect(selectAutoFollow(s)).toBe("submission");
  });

  it("prefers the FINAL report over an earlier EDA report on finish", () => {
    const s = session({
      status: "completed",
      stages: [stage("eda"), stage("report"), stage("submission")],
      artifacts: {
        eda: art("eda", "report"), // EDA is also report-kind
        report: art("report", "report"), // the final report
        submission: art("submission", "dataframe"),
      },
    });
    // Both eda and report are report-kind; rest on the LATEST one (the final report).
    expect(selectAutoFollow(s)).toBe("report");
  });
});

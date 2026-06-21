import { describe, it, expect } from "vitest";
import {
  selectIsBusy,
  selectDatasetName,
  selectHasDataset,
  selectLeaderboard,
} from "./selectors";
import { initialRunState, type RunState } from "../daemon/runState";
import type { Artifact } from "../daemon/protocol";
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

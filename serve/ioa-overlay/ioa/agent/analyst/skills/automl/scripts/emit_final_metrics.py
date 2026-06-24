# OVERLAY ADDITION — not present in the vendored ioa-agent jar.
#
# Emits `output/final_metrics.json`, a structured public sidecar the Smile Studio cockpit
# Scorecard consumes (ADR-0011/0014). The vendored automl skill records its headline numbers
# only as prose in `automl_report.md` and in the private `output/checkpoints/state.json`;
# neither is a clean structured contract. Rather than have the daemon parse report markdown
# (which ADR-0014 forbids) or reach into the private checkpoint, the SKILL.md overlay invokes
# THIS script as a final step, so the *skill* owns emitting the sidecar.
#
# Deterministic + defensive: reads state.json (the skill's own checkpoint) and, as a fallback,
# the `## Problem Setup` / `## Final Performance` sections of automl_report.md. Every field is
# best-effort — a partial final_metrics.json is fine, the frontend parser is itself defensive.
#
# Usage (run from the working dir, as the skill's final output step):
#   python3 -m ioa.agent.analyst.skills.automl.scripts.emit_final_metrics
import json
import os
import re

OUT_DIR = "output"
STATE = os.path.join(OUT_DIR, "checkpoints", "state.json")
REPORT = os.path.join(OUT_DIR, "automl_report.md")
TARGET = os.path.join(OUT_DIR, "final_metrics.json")


def _load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def _read_report():
    try:
        with open(REPORT) as f:
            return f.read()
    except Exception:
        return ""


def _first(d, *keys):
    """First present, non-null value among keys in dict d."""
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _task_type(state, report):
    raw = _first(state, "task_type", "problem_type", "task")
    if not raw:
        # Fallback: scan the report's Problem Setup line.
        m = re.search(r"(?im)^\s*[-*]?\s*task[^:\n]*:\s*([A-Za-z _-]+)", report)
        raw = m.group(1) if m else None
    if not raw:
        return None
    s = str(raw).lower()
    if "regress" in s:
        return "regression"
    if "multi" in s:
        return "multiclass"
    if "binary" in s or "classif" in s:
        return "binary"
    return None


def build_metrics():
    state = _load_state()
    report = _read_report()

    out = {}
    tt = _task_type(state, report)
    if tt:
        out["task_type"] = tt

    primary = _first(state, "primary_metric", "metric")
    if not primary:
        m = re.search(r"(?im)\bmetric[^:\n]*:\s*([A-Za-z0-9_+/-]+)", report)
        primary = m.group(1) if m else None
    if primary:
        out["primary_metric"] = str(primary)

    # Headline scores recorded across the pipeline (step 7b OOF, step 10 held-out test, etc.).
    for key, src in (
        ("oof_auc", ("oof_score", "oof_auc", "oof")),
        ("test_auc", ("test_score", "test_auc")),
        ("test_acc", ("test_accuracy", "test_acc", "accuracy")),
        ("test_f1", ("test_f1", "f1")),
        ("final_score", ("final_score",)),
    ):
        v = _num(_first(state, *src))
        if v is not None:
            out[key] = v

    rows = _num(_first(state, "n_train", "train_rows", "rows", "n_rows"))
    if rows is not None:
        out["rows"] = int(rows)

    cv = _first(state, "validation_strategy", "cv_strategy", "cv")
    if cv:
        out["cv"] = str(cv)

    ens = _first(state, "ensemble_method", "method")
    if ens:
        out["ensemble_method"] = str(ens)

    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    metrics = build_metrics()
    with open(TARGET, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Wrote {TARGET}: {json.dumps(metrics)}")


if __name__ == "__main__":
    main()

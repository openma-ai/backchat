#!/usr/bin/env python3
"""Aggregate fixed-envelope diagnostics; medians of per-run statistics, never best runs.
Run from the repository root: python3 artifacts/perf-stress-20261105/report.py
"""
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def median(values):
    return statistics.median(values)

def percentile(values, p):
    import math
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)]

def read(path):
    return json.loads(path.read_text())

def aggregate(phase):
    store = read(ROOT / f"store-{phase}.json")
    rounds = [r for r in store["rounds"] if not r["warmup"]]
    electron = [read(ROOT / f"electron-{phase}-{i}.json") for i in range(3)]
    assert len(rounds) == 5, "Expected five measured store rounds"
    assert all(r["envelope"] == electron[0]["envelope"] for r in electron), "Electron envelopes differ"
    assert all(len(r["metrics"]["history"]) >= 60 and len(r["scrollFrames"]) == 24 for r in electron), "Incomplete Electron workload"
    assert all(not r["envelope"]["cpuProfile"] for r in electron), "Profiled timings are not comparable"
    assert store["envelope"]["explicitGc"], "Post-GC memory requires an exposed GC"
    store_summary = {
        "wall_ms": {k: median(r[k] for r in rounds) for k in ["setupMs", "longReplayMs", "streamingMs"]},
        "cpu_ms": {k: median(sum(r["cpu"][k].values()) / 1000 for r in rounds) for k in rounds[0]["cpu"]},
        "memory_mib": {k: median(r["memoryAfterGc"][k] / 1024**2 for r in rounds) for k in ["heapUsed", "rss"]},
        "incremental_heap_after_gc_mib": median((r["memoryAfterGc"]["heapUsed"] - r["memoryBefore"]["heapUsed"]) / 1024**2 for r in rounds),
    }
    for k in ["switches", "structural", "read100"]:
        for stat in ["median", "p95"]:
            store_summary["wall_ms"][f"{k}_{stat}"] = median(r[k][stat] for r in rounds)
    def memory_sample(run, stage, process_type):
        return next(p for s in run["memory"] if s["stage"] == stage for p in s["processes"] if p["type"] == process_type)
    stages = [("long_load", "ready", "long-history-ready"), ("long_scroll", "long-history-ready", "long-scroll-done"),
              ("parallel_cold", "long-scroll-done", "all-history-loaded"), ("warm_switches", "all-history-loaded", "warm-switches"),
              ("burst", "warm-switches", "after-burst"), ("settled_churn", "after-burst", "settled-churn-2")]
    e_summary = {"wall_ms": {}, "cpu_ms": {}, "rss_mib": {}, "long_tasks": {}, "mounted_turns": [r["mountedTurns"] for r in electron]}
    for k, lo, hi in [("cold_switch", 0, 24), ("warm_switch", 24, 48), ("burst_switch", 48, 60)]:
        for stat, fn in [("median", median), ("p95", lambda v: percentile(v, .95))]:
            e_summary["wall_ms"][f"{k}_{stat}"] = median(fn([h["ms"] for h in r["metrics"]["history"][lo:hi]]) for r in electron)
    e_summary["wall_ms"]["long_history_ready"] = median(r["metrics"]["history"][0]["ms"] for r in electron)
    e_summary["wall_ms"]["scroll_double_frame_median"] = median(median(r["scrollFrames"]) for r in electron)
    e_summary["wall_ms"]["scroll_double_frame_p95"] = median(percentile(r["scrollFrames"], .95) for r in electron)
    e_summary["wall_ms"]["burst_total"] = median(r["burstMs"] for r in electron)
    for process_type in ["Browser", "Tab"]:
        e_summary["cpu_ms"][process_type] = {}
        for name, start, end in stages:
            e_summary["cpu_ms"][process_type][name] = median(1000 * (memory_sample(r, end, process_type)["cpu"]["cumulativeCPUUsage"] - memory_sample(r, start, process_type)["cpu"]["cumulativeCPUUsage"]) for r in electron)
        e_summary["rss_mib"][process_type] = {stage: median(memory_sample(r, stage, process_type)["memory"]["workingSetSize"] / 1024 for r in electron) for stage in [s["stage"] for s in electron[0]["memory"]]}
        e_summary["rss_mib"][process_type]["settled_churn_last_minus_first"] = median((memory_sample(r, "settled-churn-2", process_type)["memory"]["workingSetSize"] - memory_sample(r, "settled-churn-0", process_type)["memory"]["workingSetSize"]) / 1024 for r in electron)
    e_summary["long_tasks"] = {"count": median(len(r["metrics"]["longTasks"]) for r in electron), "sum_ms": median(sum(r["metrics"]["longTasks"]) for r in electron), "max_ms": median(max(r["metrics"]["longTasks"], default=0) for r in electron)}
    result = {"phase": phase, "aggregation": "Median of five warm store rounds and three independent Electron runs; raw samples retained in sibling JSON files.",
              "store_envelope": store["envelope"], "electron_envelope": electron[0]["envelope"], "store": store_summary, "electron": e_summary,
              "limitations": ["Synthetic local sessions, no provider processes or network inference.", "Xvfb/software rendering; double-rAF timings are scroll responsiveness proxies, not hardware FPS.", "Electron CPU is cumulative process CPU, including internal threads; long tasks are a separate renderer blocking proxy.", "RSS and post-GC heap measure different things. The short churn observation is not a long-duration leak certification.", "No latency gate; correctness assertions must pass before timings are accepted."]}
    (ROOT / f"{phase}.json").write_text(json.dumps(result, indent=2) + "\n")
    return result

if __name__ == "__main__":
    for prefix in ["store", "electron"]:
        suffix = "-0" if prefix == "electron" else ""
        paths = [ROOT / f"{prefix}-{phase}{suffix}.json" for phase in ["baseline", "after"]]
        if all(p.exists() for p in paths):
            envelopes = [{k: v for k, v in read(p)["envelope"].items() if k != "command"} for p in paths]
            assert envelopes[0] == envelopes[1], f"{prefix} before/after envelopes differ"
    for phase in ["baseline", "after"]:
        if not (ROOT / f"electron-{phase}-2.json").exists():
            print(f"{phase}: incomplete; refusing to aggregate")
            continue
        result = aggregate(phase)
        print(phase, json.dumps({"store": result["store"], "electron": result["electron"]}, indent=2))

# Electron high-load wave4 before → after (America/Detroit)
Baseline: electron-baseline-*.json (fd60424-era). After: wave4 (proto-share + overscan 0).

| metric | before | after | Δ% |
|---|---:|---:|---:|
| TabWS settled-churn-2 (MB) | 474.8 | 467.9 | 1.5% |
| longTasks sum | 7516 | 4455 | 40.7% |
| scrollFrames median | 51.5 | 33.6 | 34.8% |
| mountedTurns | 5 | 2 | 60.0% |
| burstMs | 3083.8 | 2346.4 | 23.9% |

Tab WS ~1–4% vs baseline (Chromium floor ~187MB ready). Not near ~50%. Store heapAfterGc ~34%.

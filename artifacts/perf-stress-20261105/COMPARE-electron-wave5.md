# Electron high-load wave5 before → after (America/Detroit)
Baseline: electron-baseline-*.json (fd60424-era). After: wave5 lazy hydrate / park inactive replay history.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| TabWS settled-churn-2 (MB) | 474.8 | 459.5 | 3.2% |
| longTasks sum | 7516 | 2128 | 71.7% |
| scrollFrames median | 51.5 | 33.9 | 34.2% |
| mountedTurns | 5 | 2 | 60.0% |
| burstMs | 3083.8 | 2700.1 | 12.4% |

Tab WS still near Chromium floor + live turns across sessions; park frees inactive replay history (SQL rematerialize on focus). Store heapAfterGc ~46%.

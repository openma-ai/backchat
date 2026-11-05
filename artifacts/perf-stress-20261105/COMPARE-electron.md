# Electron high-load before → after (America/Detroit)

3 repeats. Electron UI path is still render/DOM-bound; SessionStore microbench is the primary evidence for SessionTurnMap.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| SPEED burstMs | 3069.9 | 3052.8 | 0.6% |
| SPEED history median ms | 113.1 | 117.2 | -3.6% |
| SPEED scrollFrame median ms | 54.1 | 56.2 | -3.8% |
| CPU longTasks sum ms | 7707.0 | 8050.0 | -4.5% |
| CPU longTasks count | 93.3 | 96.7 | -3.6% |
| MEM Tab WS KB settled | 482856.0 | 499036.0 | -3.4% |

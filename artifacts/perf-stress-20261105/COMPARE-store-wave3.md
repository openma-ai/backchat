# Store stress wave3 before → after (America/Detroit)
Fair compare: baseline = fd60424 (SessionTurnMap wave1); after = wave2b + EMPTY_TURN_EVENTS compact on complete/replay + projection-cache invalidate on in-place stream mutate + overscan 0.
Both with `NODE_OPTIONS=--expose-gc`. Same host as wave2b.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| heapMB | 54.995 | 37.427 | 31.9% |
| rssMB | 250.855 | 233.598 | 6.9% |
| cpu_setup_us | 150145.000 | 60058.000 | 60.0% |
| cpu_replay_us | 16028.000 | 40076.000 | -150.0% |
| cpu_switch_us | 37425.000 | 21010.000 | 43.9% |
| cpu_streaming_us | 80675.000 | 64974.000 | 19.5% |
| cpu_structural_us | 64605.000 | 51487.000 | 20.3% |
| cpu_reads_us | 28767.000 | 29466.000 | -2.4% |
| setupMs | 107.268 | 38.073 | 64.5% |
| longReplayMs | 16.004 | 22.957 | -43.4% |
| streamingMs | 60.193 | 44.948 | 25.3% |
| switchMed | 0.024 | 0.026 | -7.5% |
| structuralMed | 0.058 | 0.064 | -9.8% |
| read100Med | 2.062 | 2.019 | 2.1% |

vs wave2b tip (48d4c10): heapAfterGc 39.980 → 37.427 (~6.4% further). Full-stress heap vs wave1 still ~32% (target ~50%).
Replay CPU/wall up from intern+compact+synthetic project path on 3k-turn history (acceptable trade for MEMORY).
Regression: stream-cache-regression green (was red on wave2b); session-store 134/137 (3 preexisting on fd60424); turn-map/history/reduce green.

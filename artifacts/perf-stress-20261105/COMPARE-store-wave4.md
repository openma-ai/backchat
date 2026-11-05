# Store stress wave4 before → after (America/Detroit)
Fair compare: baseline = fd60424 (wave1); after = wave3 + Object.create structural-share shells + stringPool clear + frozen EMPTY_TURN_EVENTS COW + fast-path patchTurn.
Both with `NODE_OPTIONS=--expose-gc`. Baseline: store-baseline-wave3.json.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| heapMB | 54.995 | 36.122 | 34.3% |
| rssMB | 250.855 | 200.934 | 19.9% |
| cpu_setup_us | 150145.000 | 57138.000 | 61.9% |
| cpu_replay_us | 16028.000 | 33495.000 | -109.0% |
| cpu_switch_us | 37425.000 | 28828.000 | 23.0% |
| cpu_streaming_us | 80675.000 | 54039.000 | 33.0% |
| cpu_structural_us | 64605.000 | 64470.000 | 0.2% |
| cpu_reads_us | 28767.000 | 27672.000 | 3.8% |
| setupMs | 107.268 | 35.132 | 67.2% |
| longReplayMs | 16.004 | 20.104 | -25.6% |
| streamingMs | 60.193 | 37.343 | 38.0% |
| switchMed | 0.024 | 0.040 | -61.5% |
| structuralMed | 0.058 | 0.093 | -61.3% |
| read100Med | 2.062 | 1.962 | 4.9% |

Setup heapDelta ~4.75 MB (wave3 ~5.97, wave1 ~21.7). heapAfterGc 54.995→36.122 (~34.3%; target ~50%). Empty floor ~25.5 MB.
Regression: proto-share + stream-cache green; session-store 139/142 (3 preexisting).

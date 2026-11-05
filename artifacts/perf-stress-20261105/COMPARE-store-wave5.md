# Store stress wave5 before → after (America/Detroit)
Fair compare: baseline = fd60424 (wave1); after = wave4 + lazy hydrate / park inactive replay history (retain rows in Node, SQL reload in Electron).
Both with `NODE_OPTIONS=--expose-gc`. Baseline: store-baseline-wave3.json.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| heapMB | 57.667 | 31.327 | 45.7% |
| rssMB | 263.041 | 241.730 | 8.1% |
| cpu_setup_us | 150145.000 | 56361.000 | 62.5% |
| cpu_replay_us | 16028.000 | 28564.000 | -78.2% |
| cpu_switch_us | 37425.000 | 100678.000 | -169.0% |
| cpu_streaming_us | 80675.000 | 56609.000 | 29.8% |
| cpu_structural_us | 64605.000 | 34590.000 | 46.5% |
| cpu_reads_us | 28767.000 | 46680.000 | -62.3% |
| setupMs | 107.268 | 39.057 | 63.6% |
| longReplayMs | 16.004 | 21.985 | -37.4% |
| streamingMs | 60.193 | 42.077 | 30.1% |
| switchMed | 0.024 | 0.147 | -500.7% |
| structuralMed | 0.058 | 0.045 | 23.0% |
| read100Med | 2.062 | 2.566 | -24.5% |

heapAfterGc 57.667→31.327 (~45.7%; target ~50%). vs wave4 ~37.9 MB. Empty floor ~25.5 MB.
Park: dematerialize inactive `replay-*` turns on setActive; Node rematerializes from retained rows (share shells); Electron drops rows + ChatPage SQL reload. Live/injected turns never parked.
Regression: park + proto-share + stream-cache green; session-store 135/138 (3 preexisting).

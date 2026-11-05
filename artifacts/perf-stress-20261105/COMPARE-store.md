# Store stress wave2b before → after (America/Detroit)
Fair compare: baseline = fd60424 (SessionTurnMap wave1); after = intern + event flyweights + HistoryRow[] structural share + length-share coalesce + projection eviction.
Both with `NODE_OPTIONS=--expose-gc`.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| heapMB | 54.998 | 39.980 | 27.3% |
| rssMB | 255.977 | 236.422 | 7.6% |
| cpu_setup_us | 163529.000 | 61241.000 | 62.6% |
| cpu_replay_us | 14818.000 | 36926.000 | -149.2% |
| cpu_switch_us | 41945.000 | 20590.000 | 50.9% |
| cpu_streaming_us | 71905.000 | 68594.000 | 4.6% |
| cpu_structural_us | 68798.000 | 45457.000 | 33.9% |
| cpu_reads_us | 31305.000 | 30009.000 | 4.1% |
| setupMs | 119.457 | 36.735 | 69.2% |
| longReplayMs | 14.800 | 21.358 | -44.3% |
| streamingMs | 60.453 | 51.275 | 15.2% |
| switchMed | 0.025 | 0.024 | 6.7% |
| structuralMed | 0.059 | 0.058 | 2.8% |
| read100Med | 2.016 | 2.043 | -1.4% |

Setup-only attribution (100×200): heapDelta 21.7 → 7.1 MB (~67%). event share 200/200.
Honest: full-stress heapAfterGc vs wave1; setup/streaming/switch as table.

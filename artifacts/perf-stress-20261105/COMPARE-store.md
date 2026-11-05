# Store stress before → after (America/Detroit)
Fair compare: baseline = HEAD SessionStore (full-map scans); after = SessionTurnMap + array cache + session-scoped scans.
Both with `NODE_OPTIONS=--expose-gc`.

| metric | before | after | Δ% |
|---|---:|---:|---:|
| CPU µs setup | 231735 | 177720 | 23.3% |
| CPU µs replay | 32139 | 23326 | 27.4% |
| CPU µs switch | 973084 | 42659 | 95.6% |
| CPU µs streaming | 265571 | 96322 | 63.7% |
| CPU µs structural | 1877648 | 71776 | 96.2% |
| CPU µs reads | 502940 | 28855 | 94.3% |
| SPEED setupMs | 179.966 | 135.036 | 25.0% |
| SPEED longReplayMs | 20.510 | 19.181 | 6.5% |
| SPEED switch median ms | 1.730 | 0.029 | 98.3% |
| SPEED read100 median ms | 48.877 | 2.265 | 95.4% |
| SPEED streamingMs | 253.928 | 75.408 | 70.3% |
| SPEED structural median ms | 3.386 | 0.063 | 98.1% |
| MEM heapAfterGc MB | 56.3 | 57.3 | -1.9% |
| MEM rssAfterGc MB | 270.2 | 267.9 | 0.9% |

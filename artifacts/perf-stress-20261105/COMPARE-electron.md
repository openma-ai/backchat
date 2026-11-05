# Electron high-load wave2b before → after (America/Detroit)

3 repeats. Wave2b: tanstack overscan 3→1 + estimateSize 180, O(1) timeline scrubber, content-visibility,
SessionStore string intern + text/event flyweights + HistoryRow[] structural share + length-share coalesce.
Baseline = wave1 electron-baseline (fd60424).

| metric | before | after | Δ% |
|---|---:|---:|---:|
| burstMs | 3083.8 | 2581.1 | 16.3% |
| historyMedMs | 113.1 | 81.0 | 28.3% |
| scrollMedMs | 51.5 | 36.0 | 30.3% |
| longTasksSumMs | 7516.0 | 4902.0 | 34.8% |
| longTasksCount | 93.0 | 67.0 | 28.0% |
| mountedTurns | 5.0 | 3.0 | 40.0% |
| tabWsKbSettled | 486164.0 | 480220.0 | 1.2% |

Electron continued to move vs wave1 flatline. Honest: still short of ~50% on several rows; mountedTurns 40% from virtualizer tune.

# SessionStore fixed-envelope comparison

Accepted source: baseline `0d2dcf6`, after `fd60424`. One warmup + five measured fresh stores. 101 sessions, 23,100 turns, 20k interleaved chunks, 500 switches, 500 tool/chunk pairs, 1,000 reads. Experiment `48d4c10` is rejected, not aggregated.

## wall_ms

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| setupMs | 170.221 ms | 136.016 ms | 20.1% |
| longReplayMs | 19.133 ms | 19.261 ms | -0.7% |
| streamingMs | 215.114 ms | 61.623 ms | 71.4% |
| switches_median | 1.594 ms | 0.025 ms | 98.4% |
| switches_p95 | 1.711 ms | 0.068 ms | 96.0% |
| structural_median | 3.247 ms | 0.058 ms | 98.2% |
| structural_p95 | 3.762 ms | 0.091 ms | 97.6% |
| read100_median | 48.446 ms | 2.143 ms | 95.6% |
| read100_p95 | 52.443 ms | 2.761 ms | 94.7% |

## cpu_ms

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| setup | 223.810 ms | 187.218 ms | 16.3% |
| replay | 34.078 ms | 19.285 ms | 43.4% |
| switch | 818.167 ms | 38.127 ms | 95.3% |
| streaming | 236.121 ms | 84.314 ms | 64.3% |
| structural | 1747.072 ms | 69.320 ms | 96.0% |
| reads | 491.589 ms | 32.008 ms | 93.5% |

## memory_mib

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| heapUsed | 54.004 MiB | 55.008 MiB | -1.9% |
| rss | 256.875 MiB | 253.027 MiB | 1.5% |

CPU is user + system process time. Setup includes longReplay, so they must not be added. switch/structural wall values are per operation; read100 values are per 100 reads; CPU values cover each whole stage. Reads include assertion overhead. Memory is post-GC with the store still reachable. Incremental heap is 27.783 → 28.823 MiB. Negative reduction means worse. No memory improvement is claimed. See [README](README.md) and [provenance](provenance.json).

# Electron fixed-envelope comparison

Median of three independent accepted runs per revision: 24 sessions (500 + 23 × 50 turns), 24 scroll jumps, 24 cold loads, 24 warm switches, 20 producers × 40 chunks, 12 switches during bursts. Visible Xvfb, software rendering, tracing/profiling disabled. Experiment `48d4c10` is rejected, not aggregated.

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| cold_switch_median | 122.450 ms | 120.800 ms | 1.3% |
| cold_switch_p95 | 170.600 ms | 165.500 ms | 3.0% |
| warm_switch_median | 96.750 ms | 98.200 ms | -1.5% |
| warm_switch_p95 | 144.300 ms | 132.200 ms | 8.4% |
| burst_switch_median | 117.300 ms | 122.200 ms | -4.2% |
| burst_switch_p95 | 167.700 ms | 136.000 ms | 18.9% |
| long_history_ready | 315.500 ms | 326.200 ms | -3.4% |
| scroll_double_frame_median | 51.550 ms | 52.200 ms | -1.3% |
| scroll_double_frame_p95 | 63.700 ms | 72.900 ms | -14.4% |
| burst_total | 3083.756 ms | 2957.750 ms | 4.1% |

## Main CPU and RSS

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| long_load | 100.000 ms | 100.000 ms | 0.0% |
| long_scroll | 40.000 ms | 40.000 ms | 0.0% |
| parallel_cold | 200.000 ms | 200.000 ms | 0.0% |
| warm_switches | 160.000 ms | 170.000 ms | -6.2% |
| burst | 720.000 ms | 710.000 ms | 1.4% |
| settled_churn | 180.000 ms | 180.000 ms | 0.0% |

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| ready | 395.664 MiB | 396.359 MiB | -0.2% |
| long-history-ready | 438.332 MiB | 438.953 MiB | -0.1% |
| long-scroll-done | 439.426 MiB | 439.715 MiB | -0.1% |
| all-history-loaded | 438.281 MiB | 438.953 MiB | -0.2% |
| warm-switches | 438.566 MiB | 439.145 MiB | -0.1% |
| after-burst | 440.547 MiB | 441.938 MiB | -0.3% |
| settled-churn-0 | 440.578 MiB | 441.973 MiB | -0.3% |
| settled-churn-1 | 440.602 MiB | 442.008 MiB | -0.3% |
| settled-churn-2 | 440.648 MiB | 442.059 MiB | -0.3% |

## Renderer CPU and RSS

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| long_load | 600.000 ms | 660.000 ms | -10.0% |
| long_scroll | 2060.000 ms | 2150.000 ms | -4.4% |
| parallel_cold | 5670.000 ms | 5660.000 ms | 0.2% |
| warm_switches | 4970.000 ms | 4710.000 ms | 5.2% |
| burst | 4350.000 ms | 4230.000 ms | 2.8% |
| settled_churn | 5140.000 ms | 5490.000 ms | -6.8% |

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| ready | 187.910 MiB | 187.949 MiB | -0.0% |
| long-history-ready | 254.949 MiB | 252.918 MiB | 0.8% |
| long-scroll-done | 379.891 MiB | 381.031 MiB | -0.3% |
| all-history-loaded | 438.633 MiB | 462.395 MiB | -5.4% |
| warm-switches | 450.809 MiB | 461.008 MiB | -2.3% |
| after-burst | 487.977 MiB | 491.164 MiB | -0.7% |
| settled-churn-0 | 486.535 MiB | 488.383 MiB | -0.4% |
| settled-churn-1 | 478.086 MiB | 485.387 MiB | -1.5% |
| settled-churn-2 | 474.770 MiB | 481.625 MiB | -1.4% |

Renderer long tasks: count 93 → 92, total 7,516 → 7,797 ms, maximum 198 → 207 ms. Existing >50 ms tasks remain. Cumulative main CPU does not measure maximum main-thread blocking. Short churn RSS last-minus-first: main +0.070 → +0.082 MiB; renderer −8.934 → −9.656 MiB. Five turns were mounted in every run.

No convincing overall Electron latency, CPU, or memory gain. Small differences are noise on this shared host; worse scroll p95 is disclosed. Double-rAF is a responsiveness proxy, not hardware FPS. Short churn is not long-duration leak certification. See [README](README.md) and [validation](validation.json).

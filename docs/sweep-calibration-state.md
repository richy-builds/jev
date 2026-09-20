# Sweep batch-size calibration

Generated 2026-09-19 by `scripts/calibrate-steam.mjs` against 10,000 Elden Ring (Steam app 1245620) reviews, 6,501 of them (65.0%) with Steam's thumbs-up. Criterion: "the reviewer recommends this game". Label: `voted_up`.

The throughput probe (see `scripts/throughput.mjs`) found the same texts matched 9% at batch 250 and 18% at batch 100 for one question, so the batch size was chosen here against labelled data rather than guessed.

**Result: batch 10, 64 in flight** (AUC 0.925 vs 0.912 at 15 / 0.887 at 20 / 0.854 at 25 / 0.789 at 35 / 0.735 at 50). Request shape: `state`. `DEFAULT_BATCH` and `IN_FLIGHT` in `lib/sweep.ts` follow this table.

| batch | in flight | accuracy @0.5 | AUC | Brier | ECE | matched | items/s | wall | p50 ms | p95 ms | tokens | cost | retries |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 64 | 81.2% | 0.925 | 0.140 | 14.6% | 51.3% | 1,702 | 5.9 s | 319 | 698 | 1,203,086 | $0.0505 | 0 |
| 15 | 64 | 80.1% | 0.912 | 0.146 | 14.6% | 51.2% | 2,650 | 3.8 s | 300 | 476 | 1,113,842 | $0.0468 | 0 |
| 20 | 48 | 78.1% | 0.887 | 0.159 | 14.7% | 51.2% | 2,670 | 3.7 s | 319 | 569 | 1,069,086 | $0.0449 | 0 |
| 25 | 48 | 75.4% | 0.854 | 0.172 | 13.8% | 52.6% | 3,174 | 3.2 s | 317 | 614 | 1,042,286 | $0.0438 | 0 |
| 35 | 32 | 70.4% | 0.789 | 0.196 | 12.4% | 55.9% | 3,038 | 3.3 s | 300 | 482 | 1,011,734 | $0.0425 | 0 |
| 50 | 24 | 67.3% | 0.735 | 0.210 | 11.7% | 59.7% | 3,652 | 2.7 s | 291 | 439 | 988,686 | $0.0415 | 0 |

## Reliability, batch 10

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 2,831 | 4.0% | 15.9% |
| 0.1–0.2 | 943 | 13.8% | 45.8% |
| 0.2–0.3 | 489 | 24.1% | 58.3% |
| 0.3–0.4 | 349 | 34.4% | 74.5% |
| 0.4–0.5 | 257 | 44.5% | 77.4% |
| 0.5–0.6 | 305 | 54.4% | 81.3% |
| 0.6–0.7 | 362 | 64.9% | 85.9% |
| 0.7–0.8 | 551 | 74.9% | 89.1% |
| 0.8–0.9 | 935 | 85.1% | 95.3% |
| 0.9–1.0 | 2,978 | 95.2% | 98.6% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–5 | 5,000 | 80.6% | 75% |
| 6–10 | 5,000 | 81.8% | 74% |

## Reliability, batch 15

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 2,514 | 4.4% | 15.4% |
| 0.1–0.2 | 1,099 | 13.9% | 41.9% |
| 0.2–0.3 | 607 | 24.0% | 60.3% |
| 0.3–0.4 | 366 | 34.4% | 70.2% |
| 0.4–0.5 | 290 | 44.5% | 73.4% |
| 0.5–0.6 | 357 | 54.7% | 79.0% |
| 0.6–0.7 | 371 | 64.6% | 86.8% |
| 0.7–0.8 | 613 | 74.8% | 89.1% |
| 0.8–0.9 | 1,053 | 84.9% | 94.2% |
| 0.9–1.0 | 2,730 | 95.0% | 98.0% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–5 | 3,335 | 83.0% | 75% |
| 6–10 | 3,335 | 80.4% | 73% |
| 11–15 | 3,330 | 76.9% | 67% |

## Reliability, batch 20

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 2,146 | 4.7% | 16.3% |
| 0.1–0.2 | 1,170 | 14.1% | 39.8% |
| 0.2–0.3 | 722 | 24.2% | 55.4% |
| 0.3–0.4 | 428 | 34.3% | 63.3% |
| 0.4–0.5 | 414 | 44.4% | 72.2% |
| 0.5–0.6 | 431 | 54.4% | 79.1% |
| 0.6–0.7 | 499 | 64.6% | 84.6% |
| 0.7–0.8 | 753 | 74.8% | 88.3% |
| 0.8–0.9 | 1,173 | 85.1% | 93.0% |
| 0.9–1.0 | 2,264 | 94.6% | 97.0% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–5 | 2,500 | 80.8% | 75% |
| 6–10 | 2,500 | 81.7% | 73% |
| 11–15 | 2,500 | 76.7% | 63% |
| 16–20 | 2,500 | 73.2% | 58% |

## Reliability, batch 25

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 1,650 | 4.7% | 16.5% |
| 0.1–0.2 | 1,125 | 14.3% | 37.9% |
| 0.2–0.3 | 794 | 24.2% | 52.9% |
| 0.3–0.4 | 601 | 34.4% | 60.1% |
| 0.4–0.5 | 574 | 44.8% | 65.0% |
| 0.5–0.6 | 601 | 54.6% | 74.2% |
| 0.6–0.7 | 638 | 64.7% | 78.1% |
| 0.7–0.8 | 900 | 74.8% | 86.0% |
| 0.8–0.9 | 1,323 | 84.8% | 90.1% |
| 0.9–1.0 | 1,794 | 94.4% | 96.9% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–5 | 2,000 | 81.1% | 76% |
| 6–10 | 2,000 | 80.4% | 73% |
| 11–15 | 2,000 | 75.9% | 63% |
| 16–20 | 2,000 | 71.0% | 52% |
| 21–25 | 2,000 | 68.5% | 44% |

## Reliability, batch 35

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 1,163 | 4.8% | 17.5% |
| 0.1–0.2 | 884 | 14.3% | 40.8% |
| 0.2–0.3 | 852 | 24.6% | 52.1% |
| 0.3–0.4 | 742 | 34.3% | 58.0% |
| 0.4–0.5 | 770 | 44.5% | 64.8% |
| 0.5–0.6 | 840 | 54.7% | 66.9% |
| 0.6–0.7 | 971 | 64.6% | 72.2% |
| 0.7–0.8 | 1,266 | 74.7% | 79.0% |
| 0.8–0.9 | 1,251 | 84.4% | 86.3% |
| 0.9–1.0 | 1,261 | 94.4% | 96.9% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–10 | 2,860 | 80.2% | 74% |
| 11–20 | 2,860 | 73.3% | 58% |
| 21–30 | 2,855 | 63.6% | 35% |
| 31–35 | 1,425 | 58.3% | 44% |

## Reliability, batch 50

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 838 | 4.8% | 16.0% |
| 0.1–0.2 | 653 | 14.8% | 39.1% |
| 0.2–0.3 | 737 | 24.7% | 56.3% |
| 0.3–0.4 | 789 | 34.6% | 59.8% |
| 0.4–0.5 | 1,010 | 44.7% | 61.6% |
| 0.5–0.6 | 1,328 | 54.8% | 66.1% |
| 0.6–0.7 | 1,507 | 64.5% | 71.7% |
| 0.7–0.8 | 1,364 | 74.4% | 75.5% |
| 0.8–0.9 | 941 | 84.0% | 85.5% |
| 0.9–1.0 | 833 | 94.3% | 97.1% |

By position inside the batch (decisiveness = mean |p − 0.5| × 2):

| position | n | accuracy | decisiveness |
|---|---:|---:|---:|
| 1–10 | 2,000 | 80.8% | 74% |
| 11–20 | 2,000 | 73.2% | 57% |
| 21–30 | 2,000 | 66.5% | 33% |
| 31–40 | 2,000 | 60.2% | 26% |
| 41–50 | 2,000 | 56.0% | 37% |

Accuracy is at a 0.5 threshold. ECE is the n-weighted mean gap between predicted and actual over the ten buckets. "Matched" is the share of reviews at p ≥ 0.5; the base rate of thumbs-up is 65.0%.

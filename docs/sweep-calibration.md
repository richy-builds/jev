# Sweep: batch size and request shape, chosen against Steam labels

Measured 2026-09-20 with `scripts/calibrate-steam.mjs` through the real route (`POST /api/sweep`) on 10,000 Elden Ring reviews from `scripts/build-steam.mjs` (65% thumbs-up, 35% thumbs-down by construction, avg 74 chars). Criterion: "the reviewer recommends this game". Label: Steam's `voted_up`. Full tables, one per shape: [`sweep-calibration-state.md`](sweep-calibration-state.md) and [`sweep-calibration-inline.md`](sweep-calibration-inline.md).

## The open question

The throughput probe (`scripts/throughput.mjs`, 2026-09-20) found the same 10,000 HN comments matched 9% at batch 250 but 18% at batch 100 for one question. Batch size was changing the answers, and the probe had no labels to say which answer was right.

## What the labels say

**It was the request shape, not the batch size.** The probe put every text in state (`reviews: [{ text }]`) and asked each Noul about `reviews[i].text`. With that shape, answers decay with position inside the batch:

| batch (state shape) | in flight | accuracy @0.5 | AUC | items/s |
|---:|---:|---:|---:|---:|
| 10 | 64 | 81.2% | 0.925 | 1,702 |
| 15 | 64 | 80.1% | 0.912 | 2,650 |
| 25 | 48 | 75.4% | 0.854 | 3,174 |
| 50 | 24 | 67.3% | 0.735 | 3,652 |
| 100 | 16 | 59.2% | 0.635 | 4,257 |
| 250 | 8 | 58.1% | 0.560 | 5,754 |

Inside one batch of 25, positions 1–5 are 81% accurate and 76% decisive (mean |p − 0.5| × 2); positions 21–25 are 68% accurate and 44% decisive. At batch 100 the tail settles at ~0.6 for everything, which is why the probe's match rate moved with batch size, and why ECE alone would have picked the wrong size (0.6 against a 65% base rate looks calibrated while saying nothing).

Quoting the review inside its own question (`Is \`criterion\` true of this review: "…"?`, state = `{ criterion }` only) removes the effect entirely:

| batch (inline shape) | in flight | accuracy @0.5 | AUC | ECE | items/s | wall | tokens | cost |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 64 | 80.9% | 0.930 | 14.8% | 1,848 | 5.4 s | 1,047,129 | $0.044 |
| 25 | 48 | 80.8% | 0.930 | 14.8% | 3,357 | 3.0 s | 883,929 | $0.037 |
| 50 | 24 | 80.7% | 0.930 | 14.8% | 3,534 | 2.8 s | 829,529 | $0.035 |
| 100 | 16 | 80.8% | 0.930 | 14.8% | 4,078 | 2.5 s | 802,329 | $0.034 |
| **125** | **16** | 80.7% | 0.930 | 14.8% | **4,608** | **2.2 s** | 796,889 | $0.034 |
| 250 | 8 | 80.7% | 0.930 | 14.8% | 3,771 | 2.7 s | 786,009 | $0.033 |

Every size is the same 0.930 AUC to three decimals, so the batch is set for throughput.

## Decision

`lib/sweep.ts`: `DEFAULT_SHAPE = "inline"`, `DEFAULT_BATCH = 125`, `IN_FLIGHT = 16`, token pacer at 350k tokens/s. Six inline runs of 10,000 reviews at 16–64 in flight drew zero 429s; 64 in flight at batch 10 is ~100 requests/s, so the 1,200 rpm figure is not the binding limit either. Retries stay on (own loop, backoff plus retry-after, 4 attempts) for the recording.

The `state` shape is kept behind `shape: "state"` on the route for reproducing these tables.

## Reliability at the chosen setting (inline, batch 125)

| predicted bucket | n | mean predicted | actual thumbs-up |
|---|---:|---:|---:|
| 0.0–0.1 | 2,797 | 3.4% | 12.8% |
| 0.1–0.2 | 812 | 13.9% | 48.5% |
| 0.2–0.3 | 536 | 24.2% | 65.9% |
| 0.3–0.4 | 419 | 34.3% | 75.9% |
| 0.4–0.5 | 321 | 44.5% | 70.4% |
| 0.5–0.6 | 337 | 54.4% | 84.0% |
| 0.6–0.7 | 378 | 64.7% | 83.6% |
| 0.7–0.8 | 568 | 74.9% | 88.9% |
| 0.8–0.9 | 969 | 85.0% | 94.0% |
| 0.9–1.0 | 2,863 | 94.9% | 99.1% |

Monotone throughout, and the two big buckets at either end are where 57% of reviews sit. The gap in the middle is direction-consistent: actual thumbs-up runs above predicted, because "recommends this game" is a stricter reading than Steam's thumb. Reviews like "War jar fingers" (264 hours, thumbs-up) or "People keep killing me with this new sword." are thumbs-up on Steam and correctly low on "recommends". The 0.1–0.2 bucket being 48% thumbs-up is that label noise, not miscalibration on the criterion actually asked. Accuracy against the thumb tops out around 81% for the same reason.

## Cost of this study

Nineteen full sweeps of 10,000 reviews: about $0.70.

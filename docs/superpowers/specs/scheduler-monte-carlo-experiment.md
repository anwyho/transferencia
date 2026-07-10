# Scheduler tuning — Monte Carlo experiment (DESIGN; build later)

**Status:** design only. Not app runtime — a side tool. When built, lives at `experiments/scheduler-sim/`.
**Purpose:** empirically set the tunable scheduler knobs so **rule-grain** mastery/retention behave right, instead of guessing numbers. Directly serves `[FLEX] [MASTERY] [VARIETY] [GRAIN]` in `language-transfer-requirements.md`.

## Why this exists
FSRS defaults + a bolt-on mastery meter expose many knobs, and **rule mastery is deliberately more lenient than card mastery**: a rule counts as mastered even with ~5% ongoing misses and requires ~20 spaced varied successes (a card: ~3 in a row). Those numbers are not obvious. We simulate a learner over a full lesson-1→30 trajectory and search knob space for configs that satisfy hard invariants and optimize objectives.

## Hard invariants (pass/fail filters — a config that fails any is rejected)
- **HARD ITEMS DON'T ROT:** when a rule is marked *mastered*, the true recall probability of its **hard** instruments stays ≥ floor (e.g. 0.85). No "mastered" rule may hide rotted hard cases.
- **EASY ITEMS DON'T OVER-DRILL:** exposures on already-known easy instruments beyond light maintenance ≤ budget (bounded wasted-rep rate).

## Objectives (optimize on the Pareto front, after invariants pass)
- **Variety:** per-session entropy across exercise types, lessons, and items (higher = better; no bombarding).
- **Progression:** sessions/days to master each lesson; **new-rule introduction rate stays healthy** (reviews don't starve new lessons).
- **Calibration:** *mastered* ⇒ true generalization probability ≥ target (e.g. 0.95) — this is where the **~5% miss tolerance** is encoded.
- **Retention:** actual recall at review time ≈ target retention.
- **Load:** daily attempts ≈ the ~10-min budget; review backlog stays bounded.

## Simulated learner (the ground truth we try to recover)
- Per-rule latent strength `s_r`: rises with spaced correct reps (diminishing returns), decays over time (forgetting curve).
- Per-item difficulty `d_i` within a rule: a **mix of easy / hard / exception** items — this heterogeneity is exactly what the "rot" invariant tests.
- `P(correct | r, i, t) = sigmoid(a·(s_r − d_i) − b·forget(Δt_since_last))`.
- Rating emission: map `P(correct)` (+ latency) to {again,hard,good,easy} with noise; model hint-reveal behavior (reveal caps at Hard).
- Archetypes: fast / average / slow learner × daily / sporadic cadence. Many random seeds ⇒ Monte Carlo.

## System under test
- The **real** `Scheduler` + `SessionPlanner` port implementations with a candidate knob config — same code path as the app (ports make this reuse possible). Injected `Clock` (advance days instantly) + seeded RNG.
- State folded from the simulated `ReviewLog` exactly like production.

## Knob search space
- **FSRS:** request-retention target; params (defaults vs optimized); grade mapping.
- **Mastery meter:** `base(rating)` values; `α` learning rate (low ⇒ many reps to saturate — the "~20 not ~3"); coverage min `K` per rule kind; hint penalty; novelty/difficulty weights.
- **Readiness:** `M_ready` threshold; miss-tolerance; N-successes-equivalent.
- **Priority weights:** retention-decay vs mastery-gap vs overdue vs star vs primary vs new-trickle fractions.
- **Budget:** attempts per session.

## Method
- Monte Carlo: N simulated learners × M seeds per knob config.
- Search: grid/random over knobs, refined by a simple optimizer; keep Pareto-optimal configs.
- Apply invariants as hard filters first; then rank survivors by objectives with confidence intervals.

## Output (committed to repo)
- Recommended **default knob values** → the app's initial scheduler config.
- **Sensitivity analysis:** which knobs matter most; safe ranges.
- Pass/fail evidence on the two invariants.
- Reproducible: seeded, versioned, rerun when the learner model or knobs change.

## Distribution tests (the "is everything well-distributed?" guarantee)
The planner is **seeded-random**, so we test the *expected* distribution over many draws, not any single session. Same harness, same ports, seeded RNG ⇒ deterministic yet exercises the full sampler.

**Hard invariants (must ALWAYS hold — assert on every simulated session):**
- Per-type per-session caps — e.g. **dialogues ≤ 1/session** (heavy, multi-rule), cloze ≤ k, etc.
- No item repeated within its exposure cooldown window.
- A **due item is never skipped past its due date** to make room for variety.
- Session budget respected (±1 attempt).

**Soft statistical bounds (hold in expectation, asserted with a confidence interval over N seeds × M days):**
- Exercise-type **entropy ≥ threshold** (variety; no bombarding by one type).
- Lesson-coverage **spread**: max/min share ≤ ratio; every eligible lesson touched within K sessions.
- due / weak / new-trickle **fractions ≈ configured** ± tolerance.
- Item **freshness**: repeats prefer high-elapsed items; `times_seen` distribution stays balanced (ties to "easy don't over-drill").
- **No starvation**: over M sessions, long-run coverage of eligible rules/lessons/types is ~proportional to priority; new-lesson introduction rate stays > 0 when caught up.

**Role:** the Monte Carlo *chooses* the knobs; these distribution tests are the **regression guardrail** that the chosen config keeps the distribution healthy as code evolves. Method: chi-square / max-min / entropy assertions over a fixed spread of seeds with enough samples that the CI is tight.

## Note on "is `due` even the right primitive?"
FSRS `due` (retention decay) becomes **one term** in a per-rule **priority** function, not the sole driver:
`priority(rule) = f(retention_decay, mastery_gap, coverage_gap, overdue, starred, bears_primary, newness)`.
"Focus down a rule" = the priority function concentrates practice on high-mastery-gap rules until mastered, then they drop to light maintenance — freeing the 10-min budget for new lessons + weak rules. The experiment tunes these weights too.

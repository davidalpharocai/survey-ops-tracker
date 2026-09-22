# PureSpectrum → SOCC import

`scripts/ps-import.mjs` turns a PureSpectrum **Buyer Surveys** export into SOCC
launches, supplier rows and a reconciled N.

```bash
# see what it would do — writes nothing
node scripts/ps-import.mjs /path/to/Buyer_Surveys_All_*.zip

# do it
node scripts/ps-import.mjs /path/to/Buyer_Surveys_All_*.zip --apply

# machine-readable, for a scheduler
node scripts/ps-import.mjs /path/to/*.zip --apply --json
```

Takes `.zip` or `.csv`, any number, in any order, plus a directory. Run from the
repo root (it reads `.env.local` for the service key).

**Exit code 0** = clean. **1** = written, but something needs a human — the
`followUp` list says what. **2** = bad input (no files, or a required column
missing); nothing was read.

---

## What it writes, per row of the export

The export is **one row per respondent**. Nothing is written per row; rows are
counted and summed into per-Survey# groups first. For each group:

| SOCC table | field | value from the export |
|---|---|---|
| `project_launches` | `label` | `Survey ID` — **the idempotency key** |
| | `project_id` | resolved (see *Matching*) |
| | `launch_date` | earliest `PS Entry DateTime` among that survey's completes |
| | `target` | `null` — the export does not carry a goal |
| | `note` | project name, country, Survey#, completes, spend, provenance |
| `project_suppliers` | `launch_id` | the launch above |
| | `supplier_id` | resolved from `Supplier Name`, created if new |
| | `n_collected` | **count of `Complete` rows** for that (survey, supplier) |
| | `cpi` | **Σ `Respondent Buyer CPI` ÷ that count** |
| | `completes_cap` | `0` — the export has no cap |
| `survey_projects` | `n_collected` | raised to Σ blast completes + Σ supplier n_collected |
| `project_data_changes` | `text` | only on segmented projects, explaining the segments were not raised |

`actual_spend` is **never written**. A database trigger recomputes it from the
supplier rows; the script checks afterwards that it did, and reports if it
didn't.

Nothing else is touched. No blasts, no costs, no `n_actual`, no dates, no stage.

### Why `cpi` is a derived average

SOCC stores one CPI per supplier row, but PureSpectrum prices **per respondent**
and the price genuinely varies inside a single survey. Storing `spend ÷ N` keeps
`cpi × n_collected` equal to the true spend to the cent, which is what
`recompute_project_spend` multiplies. Where a supplier's price varied, the note
says so, so the number is never mistaken for a quoted rate.

---

## Matching a Survey# to a project

In order, stopping at the first hit:

1. **An existing launch already covers it** — its `label` is that Survey#, *or*
   the Survey# appears in its `note` (the roll-up list). Then the launch is
   revised **upward only**.
2. **`Project Name` matches a project's Survey/Template ID.** That column is a
   **comma-separated list**, so it is split before comparing, never matched
   whole.
3. **Neither** → reported under *NO PROJECT*, never guessed. Add the name to a
   project's Survey/Template ID and re-run.

---

## The safety rules, and why each exists

**Duplicate uploads are safe.** Three independent reasons:

- Respondents dedupe on `Transaction ID`, which is globally unique (verified:
  60,678 rows → 60,678 distinct). Overlapping windows collapse correctly.
- A launch is labelled with its Survey#, so a Survey# already in SOCC matches
  the existing launch instead of creating a second one.
- Revisions are **upward only**, so a re-run cannot lower anything.

Proven rather than asserted: re-running over two already-imported exports
reports **0 to create, 0 to revise**.

**An export is a window, not a history.** A launch that began before the export
starts is *under*-counted by it — one launch holds 299 in SOCC where a 09-14
export sees 120. So the export is evidence of a floor, never of a ceiling, and
an existing figure is only ever raised.

**Roll-up projects are refused.** The older PDF importer rolled every relaunch
Survey# into one launch and named only the first few in the note (*"29
PureSpectrum surveys rolled up … and 23 more"*). On such a project a Survey# that
looks absent is probably already counted, so the script detects the admission in
the note and skips the project entirely. On PR00426 that is the difference
between leaving a reconciled project alone and inventing 62 duplicate launches.
Those Survey#s are listed in the output for manual handling.

**Only `Complete` counts.** A typical pull is ~54% terminations and ~10% drops.
A status value the script has not seen before is **reported**, not silently
bucketed.

**Segmented projects.** `sync_segment_totals()` recomputes a segmented project's
`n_collected` as the sum of its segments on every segment write, so a value
written to the parent reverts the next time anyone edits a segment. The script
still writes it, and adds a note on the project saying the segments were not
raised with it and what the correct figure is — so the number moving back is
explainable rather than mysterious.

---

## Reporting only what changed

`--state <path>` (default `scripts/.ps-import-state.json`) records each run's
per-Survey# totals. The next run prints:

```
SINCE LAST RUN (2026-09-22T22:16:28Z):
  3 new Survey#s (412 completes), 7 changed (+88 completes), 155 unchanged, 0 no longer in the window
```

State is a **convenience, not a safety mechanism** — correctness comes from
diffing against SOCC itself. Deleting the file costs a noisier summary and
nothing else. It is written only after a successful `--apply`, so a failed run
leaves the previous baseline in place.

`--json` emits the whole report including a `summary` string built for
forwarding:

> *PureSpectrum import: 21,221 completes across 165 surveys; 3 new surveys and
> +88 completes on existing ones since the last run. Wrote 5 launch(es), revised
> 2, reconciled N on 3 project(s). Nothing needs attention.*

---

## Tolerance for format drift

- `.zip` (any number of parts) or bare `.csv`.
- All-statuses exports and completes-only exports both work.
- Column names resolve case-, space- and punctuation-insensitively, with known
  aliases: `Survey ID`/`Survey #`, `Respondent Buyer CPI`/`Buyer CPI`/`CPI`,
  `Respondent Status Description`/`Status`, and so on.
- A **missing required column** (`Transaction ID`, `Survey ID`, status,
  `Supplier Name`) stops the run with exit code 2 and prints the columns it did
  find. It does not guess.
- A missing CPI column is a warning, not a stop: N still loads, spend does not.

## What it will not do

It will not create projects, map an unknown `Project Name`, lower any figure,
touch `n_actual`, or write to a roll-up project. All four are reported for a
human instead.

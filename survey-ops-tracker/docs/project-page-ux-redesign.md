# Project detail page — UX redesign (agents-vs-agents synthesis)

Generated 2026-07-23 by a 5-designer + adversarial-critic workflow that first mapped the current page from the code, then had five distinct design philosophies each propose a full redesign, critiqued/scored each, and synthesized the winner. This is the basis for "let's talk it out and improve." Nothing here is built yet — POCs accompany it for reaction.

## The core idea
The project page is a **work surface, not a document.** Treat it like a cockpit: the operator should always see the one thing to do next, edit any value where it sits, and never leave the page for routine work. Three commitments:
1. **One editing model** — click a value → inline field → it saves itself (a "Saved ✓" flash). No guessing which field needs a Save button. *Exception, deliberately kept:* money/number fields commit on Enter + ✓ with an Undo toast, never silent blur — protecting spend math from fat-finger commits.
2. **One obvious next action** — a single state-aware primary button replaces today's "click-a-bubble" tribal knowledge. "Advance to {next} →" / "Mark delivered ✓" / "Approve → pipeline" / "Resume ▶".
3. **Nothing common behind a tab; nothing rare in prime space** — Deliverables/Activity/Slack come onto Overview; empty Rerun cards, all-off Flags, dead stubs, and the rare block-override collapse until needed.

## Three POC directions (see the rendered mockups)
- **Cockpit Spine (recommended)** — the 7-stage pipeline track *is* the control: one full-width spine fuses the stepper + the state-aware CTA + a color-coded Waiting-On badge. Two hero tiles below, a calm two-column body. The balanced do-and-see option, and the safest to ship.
- **Vitals Strip** — a top color-coded 5–6 tile health dashboard (Stage · N-vs-target · Timeline · Waiting-On · Money-vs-budget · Compliance) answers "where does this stand?" with zero clicks. Glance-first and dense — tuned to a scan across many projects.
- **Guided Checklist** — the page leads with ONE big Next-Step card ("what do I do next + the button that does it") over a thin progress ribbon; everything else is quiet reference that expands on demand. Most opinionated toward making a brand-new hire productive on day one.

## Top changes, ranked (impact / effort)
1. **State-aware primary CTA welded to the pipeline spine** (high / med-high) — driven by a pure, unit-tested `stateToPrimaryAction(project, compliance)`; pre-computes the compliance gate so it relabels to "Approve compliance first" instead of promising-then-blocking. Today advancement is a grey footnote + a bubble click, and there is **no "Mark delivered" control at all**.
2. **Single-source N Collected** (high / low) — hero tile becomes the sole editor; the rail row becomes a read-only "synced Xm ago" mirror. Fixes a real drift/clobber bug (n_collected is written from two editors and clobbered by the 15-min sheet cron). **Keep N Actual editable in the rail.**
3. **6 tabs → 3** (high / med) — Overview · Insights · History. Pull Deliverables + Activity inline onto Overview; merge Activity + DataChangeLog + ProjectAuditLog into one source-filterable History; fold the Slack URL into People and drop the Links tab.
4. **Delete dead / broken UI** (med-high / low) — remove the "＋ Add cost line (coming soon)" stub; render Rerun/WaveHistory only when longitudinal/linked; fix the NewProjectSetupBanner that points users at "✦ Edit by description" (QuickEdit is never rendered — a live broken pointer).
5. **Unify the save model** (high / med) — text/select commit on blur+Enter; numeric/money commit on Enter+✓ with an Undo toast. Ends "which field needs Save?" while protecting spend fields.
6. **Slim the command bar** (med-high / low-med) — identity chips + one status pill + a labeled 3-segment Priority (None / ⚑ High / ‼ Urgent, replacing the mystery cycle) + a visible Hold/Resume + one CTA + "⋯ More" (Clone, Merge, Archive/Reopen, Back-to-Scoping, mark-blocked, Delete fenced in red). *(Partially shipped 2026-07-23: the "Actions" menu.)*
7. **Move Money up** (med-high / med) — above Flags/Sample-N, with a top-level type-correct shortcut (+Log blast for B2B, +Record collection for PS) and the newest launch auto-expanded. Ends scrolling past People/Sample-N/Flags to log spend.
8. **Demote Waiting-On** from a full hero tile to a color-coded badge on the spine (med / low) — frees the third hero slot.
9. **Flags: show all five, dim the OFF ones, highlight ON** (med / low) — cuts noise, keeps at-a-glance auditability.
10. **Relocate the floating Survey IDs card** into the People rail (med / low) — stops it competing with the tab pills; show the Edwin resolver only on a real discrepancy.

## Click wins
- Add a deliverable: 2 clicks (+ lost scroll) → **1** (inline on Overview)
- Check recent activity: 1 tab switch → **0** (inline peek)
- Change + audit history: 2 destinations → **1** filterable History tab
- Log a blast (B2B): 1 click after scrolling → **1, no scroll** (Money moved up)
- Record PS collection: ~4 interactions → **~1–2** (newest launch auto-open)
- Change captain: 3 clicks → **2** (commit on select)
- Mark delivered: undiscoverable → **1 labeled button**
- Advance a stage: "know the bubble advances" → **1 labeled "Advance to {next} →"**

## Quick wins (ship immediately, low risk)
- Delete the "＋ Add cost line (coming soon)" stub.
- Fix / cut the broken NewProjectSetupBanner "✦ Edit by description" pointer.
- Render Rerun history only when longitudinal or series-linked.
- Remove the duplicate rail N-Collected editor (keep N Actual) — tiny diff, fixes the clobber bug.
- Priority → labeled 3-segment control.
- Flags: dim OFF, highlight ON.
- CaptainRow commits on select (drop its Save button) to match SalespersonRow.
- Relocate the Survey IDs card into the rail.

## Critic scores (clarity / clicks / adoption / feasibility / aesthetics, 1–10)
- Cockpit Spine: 8 / 6 / **7** / 8 / 8 — highest adoption + safest.
- Vitals Strip: 7 / 7 / 6 / 8 / 8.
- Guided Checklist: 8 / 6 / 5–6 / 8 / 8.
- Common thread: click-efficiency scored ~6 everywhere because the real win is *confusion removed*, not raw click count.

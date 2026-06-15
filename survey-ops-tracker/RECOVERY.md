# Recovery — "I lost something, how do I get it back?"

*Plain-language guide for non-engineers. The tracker is the system of record now, so this is the safety net.*

## A project was deleted by mistake

Deleting a project no longer destroys it — it goes to the trash and is fully restorable.

1. Open the **☰ menu → Admin**.
2. Find the **Recently deleted** card.
3. Click **↺ Restore** next to the project. It returns to the board exactly as it was (all dates, steps, bids, notes, and history intact).

"Delete forever" in that same card is the only thing that truly removes a project — and it asks first. Avoid it unless you're sure.

## A field/value was changed wrongly (not deleted)

Every change is recorded. Open the project → **Audit Log** tab to see who changed what, when, and the previous value — then just type the old value back in. The master log (Admin → Audit log) shows changes across all projects.

## Something bigger went wrong (bad import, many rows changed, table issue)

The whole database is backed up automatically by Supabase.

1. Go to **Supabase → your project → Database → Backups** (link on the Admin page → Systems → Supabase).
2. Supabase keeps **daily backups**. You can restore the database to a backup point. *(If Point-in-Time Recovery is enabled on the plan, you can restore to any minute — recommended; turn it on under Database → Backups.)*
3. Restoring affects the whole database, so for a single project prefer the **Restore** button above. Use a full restore only for widespread damage.

**Before running any bulk script** (the `scripts/` folder has service-role tools that can change many rows): they all support a dry run first — run without `--execute` / `--fill-blanks` and read the summary before applying. When in doubt, ask an engineer.

## Who to call

- App/data questions: David.
- Database restore (Supabase backups/PITR): the engineer with Supabase access (see the Systems & Handover doc for owners).

---

*Maintained alongside the app. The in-app Restore covers the common case (wrong delete); Supabase backups cover everything else.*

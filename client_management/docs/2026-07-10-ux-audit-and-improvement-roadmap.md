# CCM UX Audit + Improvement Roadmap

*Generated 2026-07-10 by a multi-agent audit (UX/IA fix pass + product-improvement pass). Live app reviewed at ccm-amber.vercel.app.*

## Part 1 - Fix audit (naming, positioning, navigation, consistency)

### Cross-cutting themes
- "Study" vs "Survey" for the same object: the internal money-out record is created/navigated as a Study but read back as a Survey in reports, search, contacts, and export â€” canonical should be Study (nav, route, model, and primary CTA already use it); leave external "Survey Ops"/SOCC alone.
- Client-side people drift between "Contact" and "User", and the who-it's-for attribution column is named three different ways ("For" / "For user" / "Users") â€” reserve "user" for AlphaROC team members.
- Destructive actions on money rows are both mis-placed (Delete/Archive sits immediately beside Save) and inconsistently guarded (heavy type-to-confirm in the ledger vs one-click window.confirm in every editor table) â€” the owner already has pending task #46 for the placement half.
- Label/destination drift: tiles and links whose landing page h1 or destination doesn't match them (Client Balances -> reports hub, hub named 3 ways, Salesperson vs Relationship manager, CMS vs CCM template, Add/Record/Save/Publish verbs, Title-vs-sentence casing, admin back-links).
- Restricted-salesperson surfaces are half-finished: a My/All toggle the guide says they shouldn't even see, a /contracts/new form that 403s them, and a tooltip-less Request Credits form that is their primary money-entry screen.

### Punch list (ranked)
**#1 - high / medium - Unify "Study" vs "Survey" across the whole app**  
_Global terminology (the app's most-used object)_  
Files: `app/page.tsx (L36 subtitle), app/studies/page.tsx (L23 "Every survey"), app/reports/page.tsx (L18-19), app/reports/transactions/page.tsx (L24 metadata, L71 h1, L115/L154 body) + loading.tsx, app/reports/transactions/LedgerTree.tsx (L206 search, L222 "Contract / Study", L283-284 "has surveys"/"archive its surveys first"), app/_components/SearchBox.tsx (L25 group+sub, L103 placeholder), app/reports/transactions/ExportCreditsSummary.tsx (L20/L70/L84-88), app/users/page.tsx (L28, L63 "Surveys ->"), app/users/[id]/page.tsx (L41, L48 col, L82), app/clients/page.tsx (L114 "Contracts & Surveys ->", L203 "Surveys ->"), lib/tooltips.ts (L32 "the survey work"), app/guide/page.tsx (L17)`  
Standardize on Study/Studies in all user-facing copy for the internal object (nav, route, model, and primary CTA already use it). Rename the report to "Contracts & Studies" everywhere; fix LedgerTree so one component doesn't say both "studies" (search) and "surveys" (archive guard); change the search group/sub/placeholder, ExportCreditsSummary scope option/label, the contact pages, and the tooltip. Leave external "Survey Ops"/SOCC strings (import + socc-sync) untouched â€” that is the separate product and the collision is exactly why "survey" is ambiguous here.

**#2 - high / small - Separate Delete from Save on the money edit rows**  
_Contract / contact / salesperson inline edit tables_  
Files: `app/contracts/new/page.tsx (L118-129 row-actions: Save then red Delete), app/clients/page.tsx (UserRow L202-210: Surveys/Save/Delete inline), app/salespeople/page.tsx (SalespersonRow L102-109: Save then red Archive)`  
This is the owner's still-pending task #46. In each row-actions cell, stop rendering the destructive button immediately after Save: right-align Delete/Archive into its own trailing danger slot with a gap (group Save with the non-destructive links on the left), or drop the inline destructive control in favor of the ledger's pattern. The clients page already models the right separation for the client itself (Archive in a bottom danger-zone); mirror that for its contact rows.

**#3 - high / small - Put the "Record a new study/contract" form above the existing-records table**  
_Record a Study / Add a Contract (top sales flow)_  
Files: `app/studies/new/page.tsx (L68-106: existing table renders before the "Record a new study" heading + NewStudyForm), app/contracts/new/page.tsx (same ordering, L70-186)`  
Users arrive here to add a record; for a client with several studies the create form â€” the page's named primary action, reached from the home tile and the "+ Add study" quicklink â€” is pushed below a tall inline edit grid. Move the create form directly under the client picker and demote the existing-records table to a reference section beneath it. Apply the same reorder to both pages so they stay symmetric.

**#4 - high / medium - Standardize destructive-confirm strength on money records**  
_Ledger vs editor delete affordances_  
Files: `app/_components/DeleteConfirm.tsx (type-"Delete" guard, used only by LedgerTree L133/L281), app/clients/ConfirmButton.tsx (single window.confirm, used by contracts/new L124, studies/new/ExistingStudiesTable.tsx L278, clients/page.tsx L207, salespeople/page.tsx L106, approvals/page.tsx L59/L65)`  
The same soft-delete of a money-affecting study/contract forces a type-to-confirm ritual in the ledger but a one-click native OK in every editor table â€” and the light path lives on the dense grids where mis-clicks are most likely. Adopt DeleteConfirm for study/contract/contact/salesperson deletes in the editors so the guard matches the ledger; keep the lighter ConfirmButton only for genuinely low-stakes actions (e.g. withdraw a credit request).

**#5 - medium / medium - Make the twin editor tables save the same way (studies bulk vs contracts per-row)**  
_ExistingStudiesTable vs contracts/new inline table_  
Files: `app/studies/new/ExistingStudiesTable.tsx (single bulk form + "Save all changes", L122/L350), app/contracts/new/page.tsx (a separate <form> per row + per-row "Save", L98/L121)`  
Two visually near-identical edit grids on sibling screens use opposite save models: a user who learns "edit rows, then Save all changes" on studies will edit several contract rows and silently lose every edit except the one whose per-row Save they clicked. Give the contracts table the same bulk-form + "Save all changes" pattern (preferred), and make the helper text match across both.

**#6 - medium / small - Replace residual "User(s)" with "Contact(s)" and unify the attribution column name**  
_Client Contacts page + study attribution column_  
Files: `app/users/page.tsx (L51 column "User", L72 "No users match those filters"), app/studies/new/ExistingStudiesTable.tsx (L24 column "Users"), app/_components/TxnListView.tsx (L108 "For"), app/reports/transactions/LedgerTree.tsx (L59 "For user"), app/reports/transactions/ExportCreditsSummary.tsx (L11 "For user"), lib/tooltips.ts (clientUser/studyUser/primaryContact say "users")`  
The section is "Contacts" in nav/title but still says "User" in its table and empty state, and the who-it's-for column is labeled three ways. Rename the Client Contacts column to "Contact" and the empty state to "No contacts match those filters.", rename the ExistingStudiesTable column to "Contacts", pick one label (e.g. "For (contact)") for the attribution column across TxnListView/LedgerTree/ExportCreditsSummary, and reword the tooltips to "contact". Reserve "user" for AlphaROC team members.

**#7 - medium / small - Add field tooltips to the Request Credits form**  
_credit-requests/new (restricted rep's primary money surface)_  
Files: `app/credit-requests/new/page.tsx (L55-65: "Credits to add", "Dollars to add", "Reason" have no InfoTooltip)`  
The home tile swaps "Add a Contract" for "Request Credits" for restricted salespeople, so this is their main money-entry screen â€” yet it has zero (i) tooltips while the parallel contract form tooltips every field. Reuse TIP.creditsToAdd / TIP.dollarsToAdd for the two amount fields and add a short note tip on "Reason" (what the approver will see), matching contracts/new and the owner's tooltips-everywhere rule.

**#8 - medium / small - Fix the "Client Balances" home link (lands on the reports hub) and the hub's three names**  
_Home -> Balances & Reports / reports hub_  
Files: `app/page.tsx (L66-70 "Client Balances" -> /reports), app/reports/page.tsx (h1 "Transaction Reports" vs nav "Reports" vs home panel "Balances & Reports"), app/reports/balances/page.tsx (L9 tab title "Balance summary" vs L19 h1)`  
"Client Balances" promises balances but delivers a four-item menu. Either point it straight at /reports/balances, or rename it to "Reports"/"Balances & Reports" to match where it goes. Align the hub name (pick "Reports") across the nav, the page h1, and the home panel heading, and align the balances page tab title with its h1.

**#9 - medium / small - Hide the My/All toggle for restricted salespeople (it's a no-op)**  
_Home Client Pulse + Studies/Contracts lists_  
Files: `app/_components/ClientPulseView.tsx (L83-96 toggle always rendered), app/_components/TxnListView.tsx (L81-88 toggle always rendered), wired from app/page.tsx / app/_components/ClientPulse.tsx / app/studies/page.tsx / app/contracts/page.tsx`  
For a restricted rep the backend already scopes every list to their own clients, so "All clients" returns the same rows as "My" â€” and guide/page.tsx L77-79 explicitly says the toggle is only for approvers/admins and that "Salespeople always see just their own clients." Thread an isRestricted prop through and, when true, hide the toggle and drop the "switch to All" tooltip wording so the button doesn't imply access they lack or read as broken.

**#10 - medium / small - Guard /contracts/new against restricted users (currently a 403 dead-end)**  
_Add a Contract vs Request Credits routing_  
Files: `app/contracts/new/page.tsx (only checks currentUserReadOnly, no restricted branch; renders the full enabled form at L146-187)`  
The home tile and the contracts list already swap Add-a-Contract for Request-Credits when restricted, but a restricted rep who reaches /contracts/new by URL/bookmark/history gets the full form and a permission error on submit. Resolve currentUserIsRestricted() on this page and, when true, redirect to /credit-requests/new (or render the same "Need to add credits? Request credits" message the ledger shows), mirroring the split the list page already does.

**#11 - medium / small - Rename Balances "Relationship manager" column to "Salesperson" (and source the right value)**  
_Reports -> Client Balances_  
Files: `app/reports/balances/page.tsx (L27 header "Relationship manager", L39 shows r.client.relationshipManager), lib/tooltips.ts (relationshipManager tip), app/clients/page.tsx (L74-75 "Sales Â· {name}", treats relationshipManager as a legacy fallback for salespersonName)`  
Everywhere else the role is "Salesperson"; this report calls it "Relationship manager" and reads the legacy relationshipManager field, so a rep scanning for their own name may not recognize the column or the value. Rename the header to "Salesperson", source it from the salesperson assignment (salespersonName falling back to relationshipManager), and reword the tooltip to drop "relationship manager". Also change the client-list meta from "Sales Â·" to "Salesperson Â·".

**#12 - medium / trivial - Rename "CMS template" to "CCM import template" on the import surfaces**  
_Admin -> Import Data_  
Files: `app/admin/import/page.tsx (L21 "CMS template"), app/admin/import/ImportClient.tsx (L93 detected-format "CMS template"); already correct on app/admin/page.tsx (L43) and app/guide/page.tsx (L102)`  
This app is CCM, and "CMS" is the name of a separate, real system (the rebuilt Credit Management System) â€” "CMS template" reads like the wrong product and makes it unclear which file to download. Standardize on "CCM import template" in the two import strings to match the Admin hub and guide (aligning the non-user-facing comments in lib/importer.ts and admin/export/route.ts is a nice-to-have).

**#13 - medium / small - Make a client-name click land in one consistent place**  
_Client cross-links_  
Files: `app/reports/balances/page.tsx (L38 -> /clients?id=), app/_components/SearchBox.tsx (L21 -> /clients?id=) vs app/_components/ClientPulseView.tsx (L151/L186 -> /reports/transactions), app/_components/TxnListView.tsx (L121/L155 -> /reports/transactions), app/approvals/page.tsx (L51 -> /reports/transactions)`  
The same gesture (click a client name) goes to the edit form from Balances/search but to the ledger from the pulse/lists/approvals, so users can't build a reliable model. Pick one canonical "client home" for a name click (the ledger is the richer money view and more common intent) and use an explicit "Manage"/"Edit" affordance where the form is genuinely needed.

**#14 - medium / trivial - Add an always-visible entry point to the User Guide**  
_Top bar / help discoverability_  
Files: `app/_components/UserMenu.tsx (L39 is the only /guide link), app/_components/NavRibbon.tsx, app/page.tsx`  
The guide is reachable only from inside the account dropdown behind the email button â€” the single most useful page for Monday's sales teach-in is hidden. Add a lightweight entry point: a "Guide" item in the nav ribbon or a small "New here? Read the guide" link in the home hub header. Keep the dropdown link too.

**#15 - low / trivial - Point admin subpage back-links at the Admin hub with one label**  
_Admin hub navigation_  
Files: `app/admin/archive/page.tsx (L26 "<- Home"), app/admin/import/page.tsx (L17 "<- Home"), app/admin/socc-sync/page.tsx (L15 "<- Home"), app/admin/team/page.tsx (L26 "<- Home"), app/admin/audit/page.tsx (L82 "<- Admin"), app/admin/impersonate/page.tsx (L27 "<- Administration")`  
Four subpages back-link to Home (skipping the hub the user came from), audit backs to "<- Admin", and impersonate backs to "<- Administration" â€” three behaviors and two labels for /admin. Point every admin/*/page.tsx back-link at /admin with the single label "<- Admin"; only the top-level admin/page.tsx should back to Home. (Also align the hub h1/title "Administration" with the nav label "Admin".)

**#16 - low / small - Use one create verb per entity; drop the misleading "Publish study"**  
_Contract & Study create forms_  
Files: `app/studies/new/NewStudyForm.tsx (L95 "...when you publish", L193 button "Publish study"), app/contracts/new/page.tsx (L52 h1 "Add a Contract", L140 "Record a new contract", L184 button "Save Contract")`  
One page mixes Add/Record/Save; the study form says "Publish study," which implies making something public rather than logging spend that already happened, and "Save Contract" is the app's lone Title-Case primary button. Pick one verb per entity (e.g. "Record study"/"Record contract" or "Save study"/"Save contract"), drop the "...when you publish" helper text, and match the sentence-case convention used by every other primary button.

**#17 - medium / trivial - Disambiguate the near-identical "Contracts" and "Contacts" nav items**  
_Top-bar primary nav_  
Files: `app/_components/NavRibbon.tsx (L17-24: Home, Studies, Contracts, Clients, Contacts, Reports; /users labeled "Contacts" while its page title is "Client Contacts")`  
Two labels that differ by one letter and both start "Cont" sit two slots apart in a bar sales use constantly â€” a persistent mis-click/scanning hazard. Rename the /users item to "Client Contacts" (matching its page title) or "People", and/or reorder so the two aren't adjacent (keep Contracts near Studies; group Clients with Client Contacts).

**#18 - medium / medium - Shorten the cramped inline-edit study rows**  
_Record a Study -> ExistingStudiesTable_  
Files: `app/studies/new/ExistingStudiesTable.tsx (L189-205 per-row multi-select listbox size=3 for contacts, 8 editable columns per row)`  
Each row is ~3 text-lines tall â€” the size=3 contact multi-select consumes vertical space in every row even when contacts aren't being edited â€” so a handful of studies fills the viewport and pushes the create form further down. Collapse the per-row contact editor to a single-line summary with an on-demand "Edit" reveal, and move low-frequency fields (setup, cost type) into the existing expandable Details row.

**#19 - medium / small - Give /salespeople a role gate and one home**  
_Salespeople page placement_  
Files: `app/salespeople/page.tsx (no currentUserIsAdmin()/notFound() guard, unlike every admin/*/page.tsx), linked from both app/page.tsx (L85-91, all non-restricted users) and app/admin/page.tsx (L64-68)`  
The roster page is presented as both an everyday tool and an admin tool, and unlike the admin pages it has no role check at all â€” any signed-in user can reach the full add/edit/archive UI by URL. Decide its home: if admin-only, drop the home-panel link and add the same currentUserIsAdmin()/notFound() guard the other admin pages use; if everyday, remove it from the Admin hub. Don't list it in both.

**#20 - low / trivial - Rename the "Delete clientâ€¦" quicklink to "Archive clientâ€¦"**  
_Manage Client List -> client detail_  
Files: `app/clients/page.tsx (L117 red quicklink "Delete clientâ€¦" jumps to a <details> whose summary is "Archive this client" with an "Archive {name}" button, L163-174)`  
Same spot, two verbs: the model is soft-delete-as-archive, so "Delete" wrongly implies permanent destruction of a client's money history. Rename the quicklink to "Archive clientâ€¦" to match the summary and button; consider also muting it (it's a red, destructive-styled link sitting among the "+ Add" additive quicklinks at the top of the record).

**#21 - low / trivial - Rename New-client "Became a client on" to "Client since"**  
_Client create/edit_  
Files: `app/clients/NewClientDialog.tsx (L34 "Became a client on") vs app/clients/page.tsx (L126 edit form "Client since") and app/reports/balances/page.tsx (L28 column + detail line "Client since")`  
The same became_on value is captured under "Became a client on" but shown everywhere else as "Client since," so it isn't obvious the creation field is the value you see afterward. Rename the New-client field to "Client since" to match the edit form, the report column, and the client detail line.

**#22 - low / trivial - Match page h1 casing to the tile/link that opens it**  
_Approvals, Request Credits (casing)_  
Files: `app/approvals/page.tsx (L27 h1 "Credit approvals" vs home tile "Credit Approvals"), app/credit-requests/new/page.tsx (L30 h1 "Request credits" vs home tile "Request Credits")`  
Tiles are Title Case but a few destination h1s are sentence case, so the page a user lands on is titled differently from the tile they clicked. Pick one convention (Title Case is the majority for h1s) and make each page's h1 match its entry-point label; for approvals, settle on one form across tile/nav/page.

**#23 - low / trivial - Stop calling a client an "account" in the Salesperson picker tooltip**  
_SalespersonPicker (client create/edit)_  
Files: `app/clients/SalespersonPicker.tsx (L9 tooltip: "Who sells/owns this account.")`  
This is the only place the client entity is called an "account"; the app says "client" everywhere else, and "account" collides with the planned parent-child account concept (task #48). Change "Who sells/owns this account." to "Who sells/owns this client."

**#24 - low / small - Add the missing study tooltips on the edit table and create form**  
_Study metadata / title / date fields_  
Files: `app/studies/new/NewStudyForm.tsx (L105/L109 "Study title"/"Study date" have no tooltip, unlike the contract form's TIP.contract/TIP.contractDate), app/studies/new/ExistingStudiesTable.tsx (L295-338 Audience/Target N/Actual N/Description in the edit row have no tooltips, though the create form does)`  
Per the owner's tooltips-everywhere rule, a field explained on create but bare on edit is inconsistent â€” and Target vs Actual N is exactly what people confuse. Move the four metadata tips into lib/tooltips.ts and render them in both NewStudyForm and the ExistingStudiesTable detail grid; add tooltips to Study title/date to match the contract form.

**#25 - low / small - Resolve the dead .table-scroll class / single horizontal-scroll strategy**  
_Wide data tables_  
Files: `app/globals.css (no .table-scroll rule defined), used by app/_components/TxnListView.tsx, app/approvals/page.tsx, app/credit-requests/new/page.tsx, app/_components/ClientPulseView.tsx, app/users/[id]/page.tsx`  
.table-scroll is applied to several tables but never defined in globals.css, so the wrapper is inert and a wide table on a ~800px window can still overflow; other tables rely instead on a media query on .report/.studies-table. Pick one: either define .table-scroll { overflow-x: auto } and apply it to every wide table, or remove the unused wrapper and rely on the media query everywhere â€” then document the chosen pattern.

## Part 2 - Improvement roadmap

### Themes
- Turn Home from a scoreboard into a cockpit: every number should be clickable, ranked, and answer 'who do I contact today and why' rather than sit as inert text.
- Error-proof the money-entry paths: warn before overdrawing a client, never bounce users to a page that discards their typed input, and stop silent mis-attribution and duplicate records at the point of entry.
- Make the numbers trustworthy: fix the recurring-tracker burn model and show remaining-vs-original everywhere, so run-out dates and renewal calls are credible instead of systematically wrong for the firm's steadiest accounts.
- Close the approval loop entirely in-app: pending badges, decision notes, inline context, and role management are the cheap substitute for the email/Slack notifications that aren't wired yet.
- Derive relationship context, don't ask reps to type it: auto-built timelines, tenure, and a single-source contact record deliver light-CRM depth that stays accurate because it requires zero data-entry discipline.
- Meet reps where they are and make it fast: pre-warm cold starts, add keyboard-first search, and (once transport lands) push a weekly digest so CCM reaches out before money is lost instead of waiting to be opened.

### QUICK-WIN

**[high impact / quick] Surface pending approvals on Home tile + nav badge** (approvals-admin-permissions)  
Add an 'Approvals waiting' card to the Home cockpit (count from listCreditRequests('pending'), already fetched by the approvals page) and mirror it as a count badge on the Approvals item in NavRibbon. Make it the most prominent card when count > 0.  
_Why:_ With email transport not wired, remembering to click into /approvals is the ONLY way an approver learns work is waiting, so blocked reps sit unfunded for hours. This is the single clearest 'what to do today' cue and the data is already on the wire one page over. (Merges two reviewers' duplicate suggestions.)

**[high impact / quick] Wire up decision notes on approve/reject** (approvals-admin-permissions)  
Backend (approve_request/reject_request) and the server action already accept decision_note, but the approvals form has no input, so it's always undefined. Add a note field beside Approve/Reject (near-required on Reject) and surface decision_note as a column in the requester's 'Your requests' and 'Recently decided' tables.  
_Why:_ A rejected rep sees only a status flip to 'rejected' with zero reason, so they re-submit or ping on Slack â€” the exact round-trip this queue exists to remove. The capability is built end-to-end; it's one input and one column from done.

**[high impact / quick] Make the KPI tiles clickable, not dead text** (home-dashboard)  
Wrap each pulse-KPI value so 'Clients negative' / 'Running low <60d' scroll to or filter the Needs-attention table, 'Renewals in 30d' jumps to the Renewals table, and the two this-year figures deep-link to /reports/balances. All target lists already exist.  
_Why:_ A rep who reads '3 clients negative' instantly wants to know which three; today the number is inert and they must hunt. One-click navigation is the cheapest way to make the dashboard feel like a cockpit instead of a scoreboard.

**[high impact / quick] Add a Value column and at-risk sort to the Renewals-due table** (home-dashboard)  
RenewalRow already carries creditsAmount/dollarsAmount but the Home Renewals table renders only Client/Contract/Date/When. Add a 'Value' column and a secondary sort so the biggest-dollar renewals surface above trivial ones in the same time window.  
_Why:_ When triaging 'who do I call about a renewal today,' value at risk is the deciding factor â€” a $200k renewal in 25 days outranks a $5k one in 20. The number is already loaded; hiding it forces reps to open each contract to judge importance.

**[high impact / quick] Add âŒ˜K / '/' to jump to search, plus a 2-char query floor** (cross-cutting)  
Wire a global keydown so âŒ˜K (Ctrl+K) and '/' focus the omnibox from anywhere, show a subtle 'âŒ˜K' hint chip, and guard SearchBox so it only fetches once the trimmed term is â‰¥2 characters.  
_Why:_ Reps open the app to find one client fast â€” search is their most-repeated action. A keyboard jump removes friction and the 2-char floor stops single-letter bursts from each hammering the ~5s cold-start Neon backend.

**[high impact / quick] Type-to-filter + a 'my clients' toggle on the client list rail** (clients-contacts-crm)  
The left pane renders every client as a flat alphabetical list with no in-pane filter (the omnibox navigates away). Add a client-side text filter over the already-loaded list plus a 'My clients / All' toggle reusing the salesperson-email match the Home dashboard already uses.  
_Why:_ Reps and admins live in this two-pane editor; scrolling hundreds of names is daily friction and restricted reps just want their own accounts up top. It mirrors the Client Pulse pattern they already know, so nothing new to learn.

**[high impact / small] Show remaining-on-contract in Renewal Radar and float at-risk renewals to the top** (balances-reports-ledger)  
Renewal Radar prints the contract's ORIGINAL delta, not what's left. Add a 'Remaining on contract' column from the per-contract remaining the ledger endpoint already computes, cross-reference Balance Health status so negative/low clients renewing within 30 days sort first, and split into 'At risk' vs 'Healthy'.  
_Why:_ A rep walking into a renewal needs the opposite of deal size â€” did the client burn through it (easy expand) or barely touch it (churn/right-size risk)? Today those two facts live in two siloed reports and nobody joins them at the moment they matter.

**[high impact / small] Add totals footer, sortable columns, and per-rep subtotals to the Balances report** (balances-reports-ledger)  
Add a footer with book-wide totals (credits outstanding, dollars outstanding, CY contract value), make Credits/Dollars/CY-value/Next-renewal sortable, and group or subtotal by relationshipManager (already a column here).  
_Why:_ A manager's first two questions â€” 'how much credit is outstanding across the book?' and 'how is each rep doing?' â€” are unanswerable today without exporting and summing by hand. This also absorbs the more expensive 'by-rep rollup on Home' idea at a fraction of the effort.

**[high impact / small] Flag funded-but-dormant accounts with an 'Idle' status in Balance Health** (balances-reports-ledger)  
A client with a healthy positive balance and zero recent studies gets monthly_burn=0 â†’ run-out None â†’ status 'ok', hiding them in the OK pile. Add an 'idle' status for meaningful positive balance with zero trailing-window burn, and add the relationship-manager column this report lacks.  
_Why:_ Paid-but-not-using is the strongest early churn signal in a credit business â€” money on the table with no reason to renew â€” yet the report currently rates these accounts as the healthiest, which is backwards. This turns Balance Health into a re-engagement worklist.

**[high impact / small] Pre-warm the Neon backend before the first data click** (cross-cutting)  
Fire a fire-and-forget ping to the existing /healthz the moment the authed topbar (and login page) mounts, so the DB wakes while the user reads the Home tiles rather than on the click that eats the ~5s delay.  
_Why:_ This is the #1 felt-slowness complaint. The health route already exists, so this is almost pure wiring, and it buys most of the perceived win now â€” before the warm-pool/region infra work lands. It converts 'the app is slow' into 'it was ready when I needed it.'

### MEDIUM

**[high impact / medium] Show live balance on Record a Study and warn before drawing a client negative** (recording-flows)  
NewStudyForm shows no balance context and create_study applies no negative-draw guard. Surface the client's current credits/dollars in the form header (via api.clientBalances) and, when a study cost would push the balance below zero, show a soft non-blocking inline warning near Publish: 'draws Acme 4,200 credits â€” balance would go from 1,500 to -2,700.'  
_Why:_ This is the drawdown half of the ledger â€” where money leaves. Today reps discover an overdrawn client on the Home tile after the fact, often after the client's been told. Warning at entry (kept non-blocking, since sales sometimes pre-book knowingly) is the highest-leverage error-proofing move in this area.

**[high impact / medium] Fail gracefully on backend 400s instead of a full-page error that discards input** (recording-flows)  
Server actions throw on any non-2xx with no try/catch, so ordinary mistakes (0/0 contract, renewal before contract date, invalid contact, negative cost) hit error.tsx and wipe everything typed. Mirror the backend rules as client-side validation so common mistakes never round-trip, and catch ApiError in the action to return it as form state with the typed values preserved.  
_Why:_ Retyping a full study or contract after being bounced to a generic error page is the most enraging failure mode in any data-entry tool, and here it's reachable through everyday errors. The validation logic already exists on the backend; it just needs to fire before submit or fail without data loss.

**[high impact / medium] Fix the burn model so recurring trackers don't distort run-out dates** (balances-reports-ledger)  
A recurring tracker is booked as a SINGLE transaction carrying the full annual_total on one date, so Balance Health's trailing-90-day/3 burn either massively overstates burn (lump lands in-window) or reports zero (lump booked >90 days ago). Compute expected monthly burn from active recurring commitments (annual_total/12 for current contracts), blended with or instead of raw trailing deltas.  
_Why:_ Run-out dates are only worth showing if reps trust them, and the current method is systematically wrong for exactly the clients that matter most â€” those on recurring trackers, the firm's steadiest revenue. Fixing the model is what makes the whole 'proactive' promise credible.

**[high impact / medium] Fuse the two panels into one prioritized 'Call today' action list** (home-dashboard)  
Add a single deduplicated, ranked list that fuses signals into concrete next actions with a reason chip: 'Acme â€” overdrawn -$4k (top up)', 'Beta â€” credits out in 12d (renew)', 'Gamma â€” renews in 9d, $80k (call)'. Rank negative > running out soonest > highest-value near-term renewal, one row per client. Reuses the health + renewals rows already loaded.  
_Why:_ A rep doesn't think in 'balance health' vs 'renewal radar' silos â€” they think 'who do I contact today and why.' Two parallel tables force a mental merge and double-list clients that are both overdrawn and renewing. This reason-annotated list is the cockpit's missing centerpiece.

**[high impact / medium] Auto-derive a client activity timeline + a 'Last activity' chip** (clients-contacts-crm)  
Add a reverse-chronological timeline to the client detail pane built entirely from data CCM already owns (contracts, studies, credit requests, approvals, adjustments, archive/restore â€” all returned per client by the ledger endpoint), plus a derived 'Last activity: {date}' line in the header. No new manual note-taking or writable model.  
_Why:_ This is the crux of 'how much CRM depth without becoming a CRM': derive it. A rep opening a client before a call wants a 5-second 'where are we,' and because it costs zero data-entry discipline it will actually stay accurate â€” unlike manual CRM notes.

**[high impact / medium] Make the Contacts roster the single source of truth for 'who to call'** (clients-contacts-crm)  
Free-text primaryContactName/Cell/Email sit above a separate Contacts table (name+email only) and drift the moment one is edited. Add is_primary, phone, and title to client_users, mark one contact primary, derive the header display from the roster, and migrate existing free-text values into a contact row. Stop at title+phone+primary â€” deeper CRM depth belongs elsewhere.  
_Why:_ At renewal or before a call the rep's first question is 'who do I call and what's their number,' and today that answer lives in two places that disagree while the richer roster can't even hold a phone number. One trustworthy record with title and phone is exactly the light-CRM ceiling the money workflow needs.

**[high impact / medium] Add 'Duplicate / New like this' to seed the study form from an existing study** (recording-flows)  
Add a Duplicate action on each existing-studies row that opens the create form pre-filled from that study â€” audience, cadence, cost, contacts, contract link â€” with only the date reset to today.  
_Why:_ Recurring and longitudinal research is core to how this firm works (there's already cadence math and an auto-rerun feature), so repeat entry is the common case, not the exception. Prefilling turns a two-minute retype into a five-second date-change-and-publish.

**[high impact / medium] Catch duplicate clients at creation, not just after the fact via Merge** (cross-cutting)  
NewClientDialog posts straight to createClientAction with no duplicate check, despite the app shipping a whole Merge feature to clean up afterward. Reuse /api/search: as the rep types the client name, show a small 'Possible existing matches' list (name + Cl##### code) beneath the field.  
_Why:_ One-client-one-record and stable Cl##### codes matter for the Survey Ops write-back. Duplicates are born in this exact dialog; surfacing matches inline is the highest-leverage place to stop them, and both the search infra and the merge cleanup already exist â€” you're just moving the intervention earlier.

### BIGGER-BET

**[high impact / large] Manage approver / full-access roles in-app and show role on the Team page** (approvals-admin-permissions)  
Approvers and full-access users exist only as env vars today, so adding one means editing config and redeploying, and the Team page can't even display who is an approver. Extend the Team page to show each member's resolved role and let an admin set approver/full-access, backed by Cognito groups (names already in config.py), reusing the Cognito Admin API path the admin toggle already uses.  
_Why:_ As the sales team grows, 'promote Vineet to approver' should not require a code change and deploy, and an admin genuinely cannot answer 'who can approve credits?' from the UI today. This is the natural home for it and it directly enables the planned reduced-info sales view.

**[high impact / large] Reconstruct balance-over-time for trends and quarter-over-quarter burn** (balances-reports-ledger)  
Since every transaction is dated with signed deltas, a running balance at any historical date is fully reconstructable server-side with no schema change. Expose a per-client time series and use it three ways: a sparkline in Balance Health, a 'this quarter vs last quarter' burn comparison, and a small trend chart in the client statement PDF.  
_Why:_ Everything in this area is a point-in-time snapshot, so nobody can see trajectory. A rep who sees burn decelerating for two quarters can intervene before the renewal, not after. This is the ambitious bet that turns the whole area from status reporting into early warning.

**[high impact / large] Send a weekly per-rep Pulse digest (email first, then Slack)** (cross-cutting)  
Once email/Slack transport is wired, send each salesperson a Monday digest of THEIR Pulse â€” clients negative or running low, plus contracts renewing in 30 days â€” by reusing filterOwned() + computeKpis() per salesperson email, with a Slack variant when that connector is authorized.  
_Why:_ A dashboard is pull; busy reps won't open CCM daily to check who's about to lapse. The scoping and KPI math already exist and are unit-tested, and the longitudinal cron proves the team runs scheduled jobs, so this is mostly a transport + scheduling shell. Note: email transport is the blocking precondition.

**[high impact / large] Make the parent-child 'family' a real relationship view, not just a balance sum** (clients-contacts-crm)  
After the approved parent-child rollup ships, extend it with (a) a combined family contact roster and (b) a merged family activity timeline (reusing the auto-timeline), keeping every guardrail â€” no shared pool, scoped/partial-aware, one level deep.  
_Why:_ The reason macro accounts exist is to manage the relationship as a whole; a balance sum alone doesn't help a rep run the account. Layering contacts and recent activity across the family onto the already-designed rollup keeps the money model untouched while making the macro view worth opening.

### What already works well (build on, do not rebuild)

**home-dashboard**
- Per-rep vs whole-book framing is already built in the right place: the My/All toggle (ClientPulseView.tsx) defaults intelligently to 'mine' when the signed-in user actually owns clients, persists the choice to localStorage, and every KPI/table respects it. That is the correct spine for a daily driver â€” build on it, don't rebuild it.
- The dashboard is resilient and fast-perceived: ClientPulse.tsx fetches the three report endpoints in parallel, each .catch()-degrades to empty rather than failing the page, it sits in its own Suspense boundary so the action tiles stream instantly, and it renders nothing on an empty DB instead of showing a hollow shell.
- Every KPI and section carries an InfoTooltip explaining exactly what it counts and that the toggle scopes it ('Nothing is hidden â€” this is just a filter') â€” this matches the house 'tooltips everywhere' standard and makes the numbers trustworthy for a non-technical sales team.
- The two lists are already prioritized server-side (Needs attention is negative-first then soonest run-out; Renewals are soonest-first) and every client cell deep-links straight into that client's filtered ledger (/reports/transactions?client_id=) â€” so the dashboard is a launchpad, not a dead end.
- The empty state for 'mine' is thoughtful: instead of a blank panel it says 'No clients assigned to you need attention' with a one-click 'See all clients' fallback â€” good for reps whose book is quiet.

**recording-flows**
- Inline "add a contact" on Record a Study is genuinely well-built: the new contact is created in the SAME DB transaction as the study and joins the attribution set before validation, so a failed study never orphans a contact (backend create_study, studies.py ~L387). This removes a classic "leave the form to go make a contact, then come back" detour.
- The live "Total / yr" preview in NewStudyForm updates as you type cost and the field label adapts to cadence ("Cost per run" for trackers vs "Cost" for single). It makes the tracker math visible at entry time instead of being a surprise on the ledger.
- Renewal-date autofill is thoughtful: it defaults renewal to contract date + 1 year but tracks a `touched` flag so it never clobbers a value the user typed (RenewalAutofill.tsx). Smart default that respects intent.
- Double-submit is already handled where it matters: study and contract create both accept an Idempotency-Key and replay returns the existing row instead of inserting a duplicate (studies.py / contracts.py). Money rows won't double on a nervous double-click or retry.
- Sensible zero-config defaults throughout: date pre-filled to today, cost type defaults to credits, cadence to single, and every field is disabled with clear helper text until a client is picked â€” the form guides you to the one required first step.
- Server-side validation is solid and specific (contract requires at least one of credits/dollars, non-negative amounts, renewal strictly after contract date; study guards negative cost AND negative setup-cost sign-flip). The rules exist and are correct â€” the gap is only that they surface late (see suggestions).

**balances-reports-ledger**
- Balances are computed by pure aggregation over an immutable, dated, soft-deleted ledger (reports.py never stores a balance) â€” every figure is reconstructable and auditable, which is exactly the foundation trends and forecasts need.
- The ledger tree already does the hard part: per-contract remaining (funding minus its rolled-up studies), over-draw shown red, Unassigned + Adjustments groups, collapse/expand, and drag-reorder columns persisted per-device (LS_KEY). That per-contract remaining number is computed but under-used elsewhere.
- The system is already proactive, not just a snapshot: Renewal Radar buckets 30/60/90, and Balance Health projects a run-out date from trailing burn â€” a real head start over a plain balances list.
- The Export Credits Summary PDF is genuinely client-ready â€” scope/date-range/column configuration, a branded header, a summary box plus detail table, and it sanitizes internal staff emails into display names (staffName) so nothing internal leaks onto a client document.
- Metric definitions live in one place (tooltips.ts) written in salesperson language, and the same (i) text is reused across Balances, Renewal Radar, and Balance Health, so 'monthly burn' / 'run-out' mean the same thing everywhere.

**clients-contacts-crm**
- The scoping wall is a deliberate, well-held design: salesperson assignment is explicitly a filter/label and never a visibility gate, and the UI copy reinforces this everywhere (salespeople/page.tsx, SalespersonPicker TIP). This keeps money universally visible while still giving reps a 'my clients' lens â€” exactly the right posture for a money system-of-record, and the base every relationship feature should respect.
- The parent-child design (docs/specs/2026-07-10) is unusually disciplined for a hierarchy feature: rollup-only with no shared credit pool, flat one-level with app-layer invariants, scoping-aware 'partial' totals labeled 'your clients in this family', and an archive 409 guard. It resists classic CRM over-engineering â€” build it as written.
- Edge cases around ownership are already handled thoughtfully: an archived salesperson stays selectable on a client so editing an unrelated field doesn't force a reassignment (SalespersonPicker L33-56; clients.py _resolve_salesperson allow_current_id). That care should be extended, not redone.
- Soft-delete + archive guards protect history throughout (clients.py delete_client; the planned parent-with-children 409). Nothing in this area destroys money or relationship data.
- The contact -> surveys drill-down (users/[id]/page.tsx) already links a person to the exact work they requested, with SOCC fielding status tags. This is a real seed of a relationship view â€” people are already connected to the ledger, so a timeline is mostly a re-presentation, not new plumbing.

**approvals-admin-permissions**
- Clean, single-source role model. `resolve_role` / `is_restricted` in config.py are the ONE predicate that both read-scoping (scoping.py `client_filter`) and the credit write-gate (`require_unrestricted`) import, so the two can never disagree about who is restricted. And `scoped_client_or_404` returns 404 (never 403) so a restricted rep can't even confirm a client exists. This is genuinely well-factored security plumbing.
- The approval write path is race-safe and idempotent. `approve_request` locks the row (`with_for_update`), re-checks it's still pending (409 otherwise), and creates the adjustment through the shared `insert_adjustment` with idem_key `credit_request:{id}` â€” a double-click or double-approve physically cannot double-credit a client. Exactly right for a money system-of-record.
- Impersonation is safe by construction: admin-gated, httpOnly cookie, read-only (backend blocks all writes), auto-expires in 2h, and an unmissable persistent banner with one-click exit. The 'a QA session, not a standing grant' framing in the code shows the right instinct.
- Audit capture is out-of-band and hard to tamper: a pure ASGI middleware that logs every write AND every denied attempt (401/403), is best-effort so it can never break a user request, and ships to S3/Athena rather than the app DB â€” so it survives even a full-DB compromise.
- Requesters aren't locked out of their own workflow: restricted reps can list only their own requests and cancel their own pending ones, and the credit-request form correctly disables submission while impersonating (read-only).

**cross-cutting**
- Global search is well-engineered on both ends. The backend (backend/app/routers/search.py) is scope-aware (a restricted salesperson's omnibox only returns their own clients via scope.client_filter()), escapes LIKE metacharacters, matches SOCC codes (Cl#####/PR#####) and contact emails â€” not just names â€” and excludes soft-deleted rows. The frontend SearchBox has real combobox a11y (role=combobox, aria-expanded/controls, arrow-key + Enter/Escape nav), a 200ms debounce with AbortController, and the API route degrades a backend 500 to empty results so a hiccup never breaks type-ahead. Build ON this, don't rebuild it.
- The in-app help investment is genuinely strong and unusually complete for an internal tool: InfoTooltip is keyboard-focusable (tabIndex=0, role=note, aria-label carries the full text) and used pervasively with left/center/right collision-aware alignment, plus a self-contained /guide page mirroring USER_GUIDE.md. New users are not left guessing.
- Perceived-speed work is real and layered: per-route loading.tsx skeletons, a dedicated Suspense boundary around the three Pulse report queries so the action tiles stream instantly instead of blocking on data, LinkPending for immediate click feedback, default Link prefetch, Promise.all-parallelized auth/data fetches, and an inline pre-paint theme script that avoids a palette flash.
- Empty and zero states are thoughtful rather than blank: the Pulse 'My clients' view shows 'No clients assigned to you need attention' with a one-click 'See all clients' escape hatch, the study form tells you up front 'This client has no contracts yet â€” the study will be Unassigned,' and the client detail pane has a dedicated empty-pane treatment.
- Mobile has had a deliberate hardening pass: wide data tables become their own horizontal-scroll regions (white-space:nowrap) so the page body never scrolls sideways, the topbar wraps gracefully, and the nav ribbon becomes its own full-width horizontally-scrolling row on phones rather than stacking into a tall block.

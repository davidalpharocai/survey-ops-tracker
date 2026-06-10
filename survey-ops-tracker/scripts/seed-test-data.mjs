// Seed test data into Supabase via REST API (service role)
// Usage: node scripts/seed-test-data.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function api(method, path, body) {
  const res = await fetch(`${URL_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// --- Team members ---
const existing = await api('GET', '/team_members?select=id,name,email')
console.log(`Existing team members: ${existing.length}`)

const wanted = [
  { name: 'David Schwartzman', initials: 'DS', email: 'david@alpharoc.ai' },
  { name: 'Sam Rivera', initials: 'SR', email: 'sam.test@alpharoc.ai' },
  { name: 'Priya Patel', initials: 'PP', email: 'priya.test@alpharoc.ai' },
  { name: 'Marcus Chen', initials: 'MC', email: 'marcus.test@alpharoc.ai' },
]
const members = [...existing]
for (const m of wanted) {
  if (!members.some(e => e.email === m.email)) {
    const [row] = await api('POST', '/team_members', m)
    members.push(row)
    console.log(`Created team member: ${row.name}`)
  }
}
const byEmail = e => members.find(m => m.email === e).id

// --- Projects ---
// Board columns in order; stage checkboxes are checked for stages BEFORE the current column
const STAGE_KEYS = ['stage_doc_programming', 'stage_survey_programming', 'stage_edwin_qa', 'stage_fielding', 'stage_data_qa', 'stage_delivery']
const COLUMNS = ['Submitted', 'Doc Programming', 'Survey Programming', 'EdWin QA', 'Fielding', 'Data QA', 'Delivery']
// matches lib/utils/stage.ts getCheckboxesForColumn: a stage is checked iff the column is past it
function checkboxes(column) {
  const idx = COLUMNS.indexOf(column)
  return Object.fromEntries(STAGE_KEYS.map((k, j) => [k, idx > j + 1]))
}

const projects = [
  // Active pipeline
  { project_name: 'Cloud Spend Pulse Q2', client: 'Meridian Capital', project_type: 'B2B', captain: 'david@alpharoc.ai', salesperson: 'Tom Becker', column: 'Submitted', n_target: 150, n_collected: 0, audience_size: 1200, submitted_date: '2026-06-08', due_date: '2026-07-10', budget: 12000, actual_spend: 0, latest_next_steps: 'Kickoff call scheduled — confirm screener criteria with client.' },
  { project_name: 'GLP-1 Prescriber Tracker W3', client: 'Hawthorne Research', project_type: 'Rerun', captain: 'priya.test@alpharoc.ai', salesperson: 'Tom Becker', column: 'Doc Programming', longitudinal: true, n_target: 200, n_collected: 0, audience_size: 3400, submitted_date: '2026-06-05', due_date: '2026-07-02', budget: 9500, actual_spend: 850, latest_next_steps: 'Doc updates from wave 2 feedback in progress.' },
  { project_name: 'Enterprise AI Adoption Survey', client: 'Bluepeak Partners', project_type: 'B2B', captain: 'sam.test@alpharoc.ai', salesperson: 'Dana Holt', column: 'Survey Programming', n_target: 300, n_collected: 0, audience_size: 5000, submitted_date: '2026-06-01', launch_date: '2026-06-18', due_date: '2026-07-15', budget: 24000, actual_spend: 6200, latest_next_steps: 'Programming skip logic for section 4; ETA Thursday.' },
  { project_name: 'Retail Media Buyer Pulse', client: 'Stonebridge Advisors', project_type: 'PS', captain: 'marcus.test@alpharoc.ai', salesperson: 'Dana Holt', column: 'EdWin QA', n_target: 100, n_collected: 0, audience_size: 800, submitted_date: '2026-05-28', launch_date: '2026-06-12', due_date: '2026-06-12', budget: 8000, actual_spend: 3100, latest_next_steps: 'QA round 1 complete — 3 routing fixes pending review.', row_level_data: true },
  { project_name: 'Payments Infra Decision Makers', client: 'Meridian Capital', project_type: 'B2B', captain: 'david@alpharoc.ai', salesperson: 'Tom Becker', column: 'Fielding', survey_tool_id: 'SV-2201, SV-2202', slack_channel_url: 'https://alpharoc.slack.com/archives/C0TESTCHAN1', n_target: 250, n_collected: 142, audience_size: 2600, submitted_date: '2026-05-20', launch_date: '2026-06-03', due_date: '2026-06-10', budget: 18500, actual_spend: 11200, latest_next_steps: 'Fielding at 57% — send reminder blast Wednesday.', terminations: true },
  { project_name: 'Cybersecurity Budget Tracker W5', client: 'Hawthorne Research', project_type: 'Rerun', captain: 'sam.test@alpharoc.ai', salesperson: 'Dana Holt', column: 'Fielding', longitudinal: true, n_target: 180, n_collected: 31, audience_size: 2100, submitted_date: '2026-05-30', launch_date: '2026-06-09', due_date: '2026-06-26', budget: 7500, actual_spend: 2400, latest_next_steps: 'Soft launch complete, full sample released today.' },
  // Voter project — exercises the auto Jenna/"vote" flag logic (trigger should set both flags to true)
  { project_name: 'State Ballot Measure Voter Pulse', client: 'Civic Insights Group', project_type: 'PS', captain: 'priya.test@alpharoc.ai', salesperson: 'Jenna Kessler', column: 'Fielding', survey_tool_id: 'SV-2210', slack_channel_url: 'https://alpharoc.slack.com/archives/C0TESTCHAN2', n_target: 500, n_collected: 218, audience_size: 12000, submitted_date: '2026-05-25', launch_date: '2026-06-05', due_date: '2026-06-29', budget: 22000, actual_spend: 9800, latest_next_steps: 'Voter QA checklist started; citation language draft due to compliance.' },
  { project_name: 'Hospital CFO Sentiment Study', client: 'Crescent Health Partners', project_type: 'PS', captain: 'priya.test@alpharoc.ai', salesperson: 'Tom Becker', column: 'Data QA', n_target: 75, n_collected: 78, n_actual: 74, audience_size: 600, submitted_date: '2026-05-12', launch_date: '2026-05-26', due_date: '2026-06-11', budget: 15000, actual_spend: 13900, latest_next_steps: 'Cleaning open-ends; flagging 4 speeders for replacement.', row_level_data: true },
  { project_name: 'Freight Broker Rate Survey', client: 'Bluepeak Partners', project_type: 'B2B', captain: 'marcus.test@alpharoc.ai', salesperson: 'Dana Holt', column: 'Delivery', n_target: 120, n_collected: 124, n_actual: 119, audience_size: 1500, submitted_date: '2026-05-05', launch_date: '2026-05-18', due_date: '2026-06-09', deliver_date: '2026-06-08', budget: 10000, actual_spend: 9200, latest_next_steps: 'Deliverable sent — awaiting client sign-off.' },
  // Scoping phase
  { project_name: 'Datacenter Power Constraints Study', client: 'Stonebridge Advisors', project_type: 'B2B', captain: 'david@alpharoc.ai', salesperson: 'Tom Becker', phase: 'Scoping', scoping_stage: 'Proposal Sent', n_target: 200, audience_size: 1800, budget: null, latest_next_steps: 'Proposal sent 6/6 — follow up Friday if no response.' },
  { project_name: 'Consumer GLP-1 Switching Behavior', client: 'Crescent Health Partners', project_type: 'PS', captain: 'priya.test@alpharoc.ai', salesperson: 'Dana Holt', phase: 'Scoping', scoping_stage: 'Pricing Discussion', n_target: 400, audience_size: 9000, budget: null, latest_next_steps: 'Client pushing back on CPI — counter-proposal in draft.' },
  { project_name: 'SMB Lending Appetite Pulse', client: 'Meridian Capital', project_type: 'PS', captain: 'sam.test@alpharoc.ai', salesperson: 'Jenna Kessler', phase: 'Scoping', scoping_stage: 'New Inquiry', latest_next_steps: 'Intro call booked for 6/12.' },
  // Closed
  { project_name: 'Adtech Consolidation Survey', client: 'Bluepeak Partners', project_type: 'B2B', captain: 'marcus.test@alpharoc.ai', salesperson: 'Dana Holt', column: 'Delivery', status: 'Closed', n_target: 90, n_collected: 95, n_actual: 91, submitted_date: '2026-04-10', launch_date: '2026-04-22', due_date: '2026-05-15', deliver_date: '2026-05-13', budget: 9000, actual_spend: 10400, latest_next_steps: 'Delivered and closed. Went over budget on sample top-up.' },
]

// --reset wipes all projects first so the new fields are populated fresh
if (process.argv.includes('--reset')) {
  await api('DELETE', '/survey_projects?id=not.is.null')
  console.log('Reset: deleted all existing projects')
}

const existingProjects = await api('GET', '/survey_projects?select=project_name')
const existingNames = new Set(existingProjects.map(p => p.project_name))

let created = 0
for (const p of projects) {
  if (existingNames.has(p.project_name)) { console.log(`Skip (exists): ${p.project_name}`); continue }
  const { captain, column, ...rest } = p
  const row = {
    ...rest,
    captain_id: byEmail(captain),
    phase: p.phase ?? 'Active',
    status: p.status ?? 'Open',
    board_column: column ?? 'Submitted',
    ...(p.phase === 'Scoping' ? {} : checkboxes(column)),
  }
  await api('POST', '/survey_projects', row)
  console.log(`Created: ${p.project_name} [${row.phase}/${row.board_column}]`)
  created++
}
console.log(`\nDone. ${created} projects created, ${members.length} team members total.`)

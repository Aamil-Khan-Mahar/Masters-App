# UI/UX plan — one place for every application

Audit of every page on 11 Oct 2026, after the "night season" redesign. Plan only; nothing here is built yet.
Goal: one person runs a whole application season (programs, tests, scholarships, letters, essays, money) from this app,
for a master's now and equally for a bachelor's or PhD. Keep the current look; fix clarity, consistency and gaps.

## Ground rules for this pass
- **One vocabulary, one format.** The same thing is always called and shown the same way on every page.
- **Yellow budget: one yellow button per screen.** Row-level actions ("Add to shortlist", "Add & research") use the quiet button. Yellow only works as "act on this" if it's rare.
- **Every number has a label.** No bare "5" or "100".
- **Nothing wild.** No new visual language, no rewrites of working flows.

---

## A. Across the whole app

| # | Problem | Fix |
|---|---|---|
| A1 | Countdowns use three formats: "in 65 days" (dashboard), "in 2mo", "in 51d" (13 other places). | One `countdown()`: "65 days", "4 months"; always paired with the date where there's room. |
| A2 | Deadline labels are raw research notes: "Application for Fall 2027. Program page: 'December 15 for…'". Shown on program pages, calendar, dashboard. | Show a short label ("Application", "Supporting documents") with the note one click away. Backend: researcher returns `label` + `note` separately; UI falls back to the first clause for old data. |
| A3 | 25 primary (yellow) buttons; Research and Shortlist put one on every row. | Apply the yellow budget above. |
| A4 | Some colours still break the system: recommender Academic/Industry badges are blue/yellow; Shortlist score meters are coloured. | Neutral badges; white meters (as `ScoreMeter` already does). |
| A5 | Names vary: "Example University", "Example", program titles 60+ characters, truncated differently per page. | One short display name per application ("Example MSc Data Science"), full title on hover and on the program page. |
| A6 | Dashboard renders nothing while loading; some empty states are vague. | Quiet "Loading your applications…" line; every empty state says what to do next and links there. |
| A7 | Phone layout not verified since the redesign. Known risks from the code: program header (7 buttons wrap), Pipeline (7 columns), season map (scrolls sideways), Shortlist rows (4 meters + button). | Check each page at 390px in Chrome device mode and fix what breaks. |
| A8 | Navigation: 10 items; Programs, Pipeline, Shortlist and Research's "Tracked" table are four views of the same list. Agent Town sits among workflow pages. | Keep the pages, but order the nav by the season: **Dashboard, Research, Programs, Shortlist, Pipeline, Calendar** / **Scholarships, Recommenders, Tests, Essays** / **Profile, Agent Town**. Remove the duplicate Tracked table (see Research). |

## B. Page by page

### Dashboard
- **Next up** shows only Shortlisted/Preparing programs; with one program, most of the column is empty. Add a **This week** list above it: checklist items, letters to request, tests to book, fees to pay — whatever is due in the next 7–14 days, across everything.
- **Stages** card is mostly zeros and repeats the sentence above it. Replace with the dot track per stage inline, or drop it.
- **Season map:** also pin scholarship deadlines and test events (e.g. a test score that expires before the intake starts, worth seeing).
- **Letters outstanding:** show when each was asked and when to nudge, not just "planned".

### Research
- The page does four jobs: search, suggestions, results, and a tracked table. The tracked table duplicates Programs → replace with a single line linking to Programs ("7 tracked. 1 not researched yet.").
- Result cards: one quiet "Add" and one "Add and research" (not yellow); clamp the description to 3 lines; show country and degree type as plain text.

### Programs
- Big serif number on each card has no label → "Fit 5.5 / 10".
- Countdown → date ("15 Dec, 65 days").
- Add a stage filter next to Active / All / Archived.

### Pipeline
- Empty stages take as much width as full ones → collapse empty columns to a narrow strip that expands on drag-over.
- Moving a card needs a drag → add a stage menu on each card (works on phone and keyboard).

### Shortlist
- Four tiny meters per row (Fit, Cost, Admit, Career) are hard to read → show numbers with the overall score, meters only on hover/expand.
- "Add to shortlist" on every row in yellow → quiet button; "Shortlisted" as a plain state.
- "Adjust weights" hides the weights → show them inline as percentages.

### Scholarships
- Empty because the 12 scholarship folders are deleted in the working copy (still in git). Not a UI bug; restore with `git restore Applications/Scholarships`.
- Cards should show amount, deadline and eligibility at a glance, and which programs each one funds.

### Recommenders
- Category badges coloured → neutral.
- Per person: what's pending, ask-by date (deadline minus 4–6 weeks), last reminder. Matrix stays.
- Optional: "Copy request email" with programs, deadlines and portal links filled in.

### Essays (today "SOP Coach")
- Built for one SOP per program. PhDs need research statements and personal statements; bachelor's need several essays per school. → Each application holds a list of essays (prompt, word limit, draft, coach feedback). The SOP becomes one essay type.
- Show word count against the program's limit.

### Calendar
- Include test dates/expiry and scholarship deadlines (scholarships already show; tests don't exist yet).
- "Export to Google/Apple calendar" (.ics download).

### Program page
- Header has 7 actions (Edit, Use Opus, Research all again, Score fit, SOP coach, Archive, Delete) → keep Edit + one contextual primary; the rest in a "More" menu; Delete never next to Edit.
- Right column is still small boxes → ruled sections like the rest.
- "What to do next" is good; apply A2 so steps read cleanly.

### Profile
- Weights show "100 / 100 / 100 / 100" (stored values) → show as share of total (25% each).
- AI usage log (26 raw call lines) belongs on Agent Town's records, not the profile.
- Test scores render as pasted markdown → move to the Tests page (below).

### Agent Town
- Works. Legend text is small; records list could filter by program. Low priority.

## C. Missing pieces for "everything in one place"

1. **Tests page.** TOEFL/IELTS/GRE now; SAT/ACT for bachelor's. Per test: date, scores, expiry, PDF. Per program: required minimums vs your scores (pass/short), score send status and cost. Reads and writes `Common/Test-Scores/`.
2. **Documents per application.** Transcript (certified?), degree certificate, WES/credential evaluation, passport, CV version used. Today these are loose checklist lines.
3. **Money view.** Fees exist; add scholarship award totals against each program's cost gap (the program page already computes the gap).

## D. Bachelor's and PhD

Add `level` (bachelor / master / phd) to the profile; vocabulary and defaults follow it, the data model stays the same.
- **Name:** wordmark from the profile ("Fall 2027 applications") instead of the fixed "Masters".
- **Checklist templates per level.** PhD: research statement, supervisor contact, writing sample, interview. Bachelor's: Common App/UCAS essays, counsellor letter, SAT/ACT, financial aid forms (CSS Profile).
- **Faculty tab:** prominent for PhD and research master's, hidden for bachelor's.
- **Recommenders:** required count per program drives the matrix.
- **Tests:** list of test types follows the level.

## E. Order of work

1. **Consistency (one session):** A1–A6, Programs fit label, Profile weights, recommender badges, Shortlist meters, program header "More" menu and right column.
2. **Workflow:** Dashboard "This week", Pipeline collapse + stage menu, Research cleanup, Calendar export, phone pass (A7).
3. **Scope:** Tests page, Essays, documents per application, nav order (A8), `level` for bachelor's/PhD.

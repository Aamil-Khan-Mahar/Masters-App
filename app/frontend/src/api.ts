// Typed client for the FastAPI backend.

export type Stage = 'researching' | 'shortlisted' | 'preparing' | 'submitted' | 'interview' | 'decision' | 'final' | 'dropped'
export type RecStatus = 'planned' | 'requested' | 'reminded' | 'submitted'

export interface Deadline { label: string; date: string; done?: boolean }
export interface ChecklistItem { item: string; done: boolean }
export interface Expense { label: string; amount: number | null; currency: string; paid: boolean; date: string | null }
export interface RecAssignment { id: string; status: RecStatus; requested_on?: string | null; submitted_on?: string | null; notes?: string }
export interface FacultyContact {
  name: string
  email: string
  research: string
  contacted_on: string | null
  status: string
  notes: string
  /** Your order of preference, 1 first (Supervisors tab). */
  rank?: number
  /** Named as a potential supervisor on your application. */
  final?: boolean
}
export interface Admission {
  gpa?: string
  english?: string
  gre?: string
  background?: string
  prerequisites?: string[]
  documents?: string[]
  letters?: string
  notes?: string
}
export interface FacultyProfile { name: string; title: string; department?: string; research: string; why?: string; url: string; accepting?: 'yes' | 'no' | 'unknown'; match?: 'strong' | 'possible' | 'weak'; researched_on?: string; deep_dive_on?: string; /** false: added from an extra page, not on the program's supervisors list */ listed?: boolean; source?: string; /** Your ranking across this program's faculty, 1 = best */ rank?: number; /** Research group, e.g. "Bayesian and statistical computing" */ group?: string; /** Ranking tier, e.g. "Contact first" */ tier?: string }
/** A faculty deep dive saved at <program>/Faculty/<Name>.md; `notes` is the applicant's own section, kept across re-runs. */
export interface FacultyFile { exists: boolean; meta: { researched_on?: string; sources?: string[] }; text: string; notes: string; file?: string }
export interface FundingAward { name: string; amount: string; amount_usd_per_year: number | null; eligibility: string; how: 'automatic' | 'nomination' | 'application'; deadline: string; url: string }
export interface FundingDetails {
  summary?: string
  guaranteed?: 'yes' | 'partial' | 'no' | 'unknown'
  typical_package?: string
  typical_package_usd_per_year?: number | null
  assistantships?: string
  awards?: FundingAward[]
  external?: { name: string; provider: string; amount: string; eligibility: string; url: string }[]
  notes?: string
}
export type CheckStatus = 'met' | 'partial' | 'missing' | 'unclear'
export interface CourseRequirement { requirement: string; status: CheckStatus; evidence: string[]; ects: number | null; note: string; source: string }
export type ReqStatus = 'met' | 'likely' | 'maybe' | 'not met' | 'unclear' | 'to do' | 'not applicable'
export type ReqGroup = 'degree' | 'subject-credits' | 'courses' | 'grades' | 'language' | 'tests' | 'documents' | 'application' | 'selection' | 'deadlines' | 'other'
export interface ReqQuote { text: string; translation: string; source: number; location: string; verified?: 'exact' | 'close' | 'not found' }
export interface ReqPart { label: string; required: string; have: string; status: ReqStatus; evidence: string[] }
export interface ReqItem {
  key: string
  group: ReqGroup
  title: string
  kind: 'must' | 'conditional' | 'scored' | 'document' | 'step'
  applies_if: string
  applies_to_you: 'yes' | 'no' | 'unclear'
  quotes: ReqQuote[]
  parts: ReqPart[]
  status: ReqStatus
  assessment: string
  evidence: string[]
  ects_required: number | null
  ects_counted: number | null
  how: string[]
  deadline: string
}
export interface ReqDocument { n: number; url: string; type: string; title: string; status: 'read' | 'partly read' | 'failed'; error?: string; file?: string; chars?: number }
export interface ReqMine { done?: boolean; status?: ReqStatus | ''; note?: string; updated_on?: string }
/** Requirements.md beside a program: the full entry-requirements checklist, plus your own ticks and notes. */
export interface Requirements {
  program?: string
  checked_on?: string
  verdict?: CourseCheck['verdict']
  summary?: string
  items?: ReqItem[]
  unresolved?: string[]
  questions?: string[]
  documents?: ReqDocument[]
  mine: Record<string, ReqMine>
}
export interface RequirementsSummary { verdict?: CourseCheck['verdict']; items: number; done: number; counts: Partial<Record<ReqStatus, number>>; checked_on?: string }
export interface RequirementsRow {
  id: string; name: string; university?: string; country?: string; stage: Stage
  summary: RequirementsSummary | null
  open: { key: string; title: string; group: ReqGroup; status: ReqStatus; kind: ReqItem['kind'] }[]
}
/** Your courses checked against a program's official academic requirements. */
export interface CourseCheck {
  verdict?: 'eligible' | 'likely' | 'at risk' | 'not eligible' | 'unclear'
  summary?: string
  requirements?: CourseRequirement[]
  gaps?: string[]
  actions?: string[]
  sources?: string[]
  checked_on?: string
}
export interface CourseFact { label: string; value: string }
/** One course from Common/Course-Outlines/Courses.md; facts are its "- **Label:** value" lines. */
export interface Course {
  code: string
  title: string
  department: string
  facts: CourseFact[]
  fields: CourseFact[]
  description: string
  outcomes: string[]
  topics: string[]
  texts: string[]
  outline_path: string | null
  has_outline: boolean
  note?: string
  semester_taken?: string
  credits?: string
  grade?: string
}
export interface Courses { exists: boolean; path: string; intro: string; modified?: string; areas: { name: string; ects: number }[]; courses: Course[] }
export interface Scores { fit?: number; cost?: number; admit?: number; career?: number; tier?: 'reach' | 'target' | 'safety'; rationale?: string; scored_on?: string }

/** A per-program resume: the master with whole entries removed or reordered, compiled and checked against the page limit. */
export interface ResumeBuild {
  built_on: string
  built_at: string
  pages: number
  max_pages: number
  fits: boolean
  sections: { id: string; title: string; entries: string[] }[]
  removed: { section: string; title: string; auto: boolean }[]
  rationale: string
  /** Kept sections and entry ids (builds since entries could be ticked by hand). */
  plan?: { id: string; entries: string[] }[]
  /** Built from entries you ticked, not chosen by Claude. */
  picked?: boolean
}

/** The master resume's sections and entries, for ticking them by hand. Sections without entries (skills) are one block. */
export interface ResumeSection { id: string; title: string; tex: string; entries: { id: string; title: string; tex: string }[] }
export interface ResumeEditLog { at: string; instruction: string; changes: string[]; note: string }

export interface Application {
  id: string
  kind: 'program' | 'scholarship'
  name: string
  country: string
  url: string
  stage: Stage
  decision: 'admitted' | 'waitlisted' | 'rejected' | null
  response: 'accepted' | 'declined' | null
  /** True exactly when the stage is 'dropped' (Not considering); the server keeps the two in step. */
  archived: boolean
  /** The stage it was at before Not considering, to go back to. */
  stage_before?: Stage
  deadlines: Deadline[]
  requirements: string[]
  checklist: ChecklistItem[]
  portal: { url: string; username: string }
  recommenders: RecAssignment[]
  expenses: Expense[]
  sources: string[]
  researched_on: string | null
  added_on?: string
  body: string
  has_sop: boolean
  /** Test name -> date official scores were sent to this program. */
  score_sends?: Record<string, string>
  /** Required documents you've marked ready for this application. */
  documents_ready?: string[]
  /** This program's own wording for some resume entries (entry or section id -> LaTeX). The master stays as it is. */
  resume_edits?: Record<string, string>
  /** What you asked the resume editor and what it did, newest first. */
  resume_edit_log?: ResumeEditLog[]
  /** Which of your files (path under Common/) goes with each required document, when you picked one. */
  documents_files?: Record<string, string>
  /** Statements this application asks for; when missing, one is derived from sop_prompt (see essaysFor). */
  essays?: Essay[]
  /** Ids of statements with a draft on disk. */
  essays_started?: string[]
  /** Apply-mode tasks marked final that have no field of their own ("essay:sop", "resume"). */
  tasks_done?: string[]
  /** Targeted requests to Claude ("add the IELTS minimum"), newest first. */
  asks?: AskEntry[]
  // programs
  university?: string
  city?: string
  degree?: string
  intake?: string
  duration?: string
  tuition?: string
  tuition_usd_per_year?: number | null
  living_usd_per_year?: number | null
  funding?: string
  faculty?: FacultyContact[]
  scores?: Scores
  course_check?: CourseCheck
  /** Your own overall comment on the program. */
  comment?: string
  requirements_check?: RequirementsSummary
  resume?: ResumeBuild
  scholarships?: string[]
  overview?: string
  format?: string
  structure?: string
  courses?: string[]
  admission?: Admission
  faculty_profiles?: FacultyProfile[]
  faculty_source_url?: string
  funding_details?: FundingDetails
  funding_researched_on?: string | null
  faculty_researched_on?: string | null
  /** Extra pages (department contacts, lab lists) whose people were added as not officially listed. */
  faculty_extra_urls?: string[]
  labs?: { name: string; focus: string; url: string }[]
  outcomes?: string
  sop_prompt?: string
  // scholarships
  selection?: string[]
  awards_per_year?: string
  provider?: string
  coverage?: string
  eligibility?: string[]
  programs?: string[]
}

/** The email telling a recommender which reference invitations to expect (Common/Recommenders/<id>/Request-email.md). */
export interface LetterEmail { subject: string; body: string; at: string | null }

export interface Recommender { id: string; name: string; role: string; category: string; email: string; body: string }

export interface Profile {
  name: string
  email: string
  nationality: string
  current_role: string
  undergrad: { university: string; degree: string; gpa: string; scale: string; graduated: string }
  interests: string[]
  goals: string
  target_countries: string[]
  target_intake: string
  degree_types: string[]
  budget_usd_per_year: number | null
  funding_need: string
  shortlist_weights: { fit: number; cost: number; admit: number; career: number }
  /** ISO code of the currency your card is in, e.g. 'USD'. */
  home_currency: string
  card_charges: { fx_fee_pct: number; tax_on_fee_pct: number }
  tests?: TestResult[]
  /** What the tests agent was told and what it did, newest first. */
  tests_log?: { at: string; note: string; answer: string }[]
  body: string
  exists: boolean
}

/** One sitting of a standardised test (TOEFL, IELTS, GRE, SAT…). Stored in Common/Profile.md. */
export interface TestResult {
  name: string
  date: string
  total: number | null
  max: number | null
  sections: { name: string; score: number | null; max: number | null }[]
  expires: string | null
  file: string
  notes?: string
}

/** 'supervisor' is a first email to a supervisor you're tracking: written in the same editor, never one of the application's statements. */
export type EssayType = 'sop' | 'soi' | 'personal' | 'research' | 'other' | 'supervisor'
/** One statement an application asks for. `id` names its files (sop -> SOP.md, soi -> SOI.md, else Essay-<id>.md). */
export interface Essay { id: string; type: EssayType; title: string; prompt: string; limit: number | null; /** Key of the required document it was started from, if any. */ from?: string; /** Supervisor emails: who it's to. */ person?: string }

/** A snapshot of an essay in Versions/<stem>/<id>.md. `auto` ones were taken for you (autosave, before a review…). */
export interface EssayVersion { id: string; label: string; auto: boolean; saved_at: string; words: number }
/** Your note pinned to a passage of a draft; start/end are character offsets, `quote` the passage as it was. */
export interface EssayComment { id: string; start: number; end: number; quote: string; text: string; created: string; resolved: boolean }

export interface AskEntry { at: string; question: string; answer: string; changed: string[]; sources: string[] }

export interface Fx { base: string; rates: Record<string, number>; updated: string; stale?: boolean }

/** Where the applicant's data lives and whether it's been created. `exposed`: inside the app's git repo and not ignored. */
export interface SetupStatus { data_root: string; ready: boolean; git: boolean; exposed: boolean | null; sample_available: boolean }

export interface Meta {
  data_root: string
  setup: SetupStatus
  ai_configured: boolean
  ai_backend: 'api' | 'claude-code' | null
  model: string
  model_strong: string
  ai_spend_usd: number
  stages: Stage[]
  today: string
}

export interface Usage { backend?: 'api' | 'claude-code'; equivalent_api_usd?: number; model: string; input_tokens: number; output_tokens: number; web_searches: number; cost_usd: number }

export type JobStatus = 'waiting' | 'working' | 'done' | 'error' | 'cancelled'
export type Role = 'scout' | 'researcher' | 'recruiter' | 'accountant' | 'assessor' | 'coach'
export type Building = 'observatory' | 'library' | 'faculty_hall' | 'bank' | 'admissions' | 'studio'
export interface Activity { at: string; text: string }
export interface Mission { id: string; label: string; app_id: string }

export interface Job<T = unknown> {
  id: string
  kind: string
  role: Role
  building: Building
  agent: string
  label: string
  status: JobStatus
  created: string
  started: string | null
  finished?: string | null
  params?: { app_id?: string; query?: string; kind?: 'program' | 'scholarship'; name?: string; essay?: string; question?: string; note?: string }
  activity: Activity[]
  mission?: Mission | null
  depends_on?: string[]
  model?: string | null
  result?: T
  result_summary?: string
  usage?: Usage
  error?: string
  from_history?: boolean
}

export interface MissionStart { mission: Mission; agents: Job<Application>[]; skipped: string[] }

export const isActive = (j: Pick<Job, 'status'>) => j.status === 'waiting' || j.status === 'working'

export interface Candidate {
  name: string
  university: string
  provider: string
  country: string
  city: string
  degree: string
  url: string
  why: string
  deadline_hint: string
}

export interface SavedSearch {
  query: string
  kind: 'program' | 'scholarship'
  at: string
  results: Candidate[]
}

export interface DocFile { path: string; name: string; folder: string; size: number; modified: string }
/** <application>/Final/: what the app copied in (label = what it is) and files you added yourself (yours). */
export interface FinalFile { name: string; size: number; modified: string; label: string | null; yours: boolean }
export interface FinalFolder {
  folder: string
  files: FinalFile[]
  /** What can't be in the folder yet; key is the Apply to-do it comes from. */
  missing: { key: string | null; label: string; why: string }[]
  /** A source changed since the last update. */
  stale: boolean
  notes: string[]
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }
  return res.json()
}

const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/')

export const api = {
  meta: () => request<Meta>('GET', '/api/meta'),
  setup: (example: boolean, git: boolean) => request<SetupStatus>('POST', '/api/setup', { example, git }),
  applications: () => request<Application[]>('GET', '/api/applications'),
  create: (data: Partial<Application>) => request<Application>('POST', '/api/applications', data),
  update: (id: string, patch: Partial<Application>) => request<Application>('PATCH', `/api/applications/${enc(id)}`, patch),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', `/api/applications/${enc(id)}`),
  research: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/research`, { strong }),
  mission: (id: string, strong = false, force = false) => request<MissionStart>('POST', `/api/applications/${enc(id)}/mission`, { strong, force }),
  researchFunding: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/funding`, { strong }),
  fetchFaculty: (id: string, url: string, strong = false, extra = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/faculty`, { url, strong, extra }),
  researchFacultyMember: (id: string, name: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/faculty-member`, { name, strong }),
  facultyDeepDive: (id: string, name: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/faculty-member/deep-dive`, { name, strong }),
  facultyProfile: (id: string, name: string) =>
    request<FacultyFile>('GET', `/api/applications/${enc(id)}/faculty-member/profile?name=${encodeURIComponent(name)}`),
  saveFacultyNotes: (id: string, name: string, notes: string) => request<{ ok: boolean }>('PUT', `/api/applications/${enc(id)}/faculty-member/notes`, { name, notes }),
  researchAllFaculty: (id: string, strong = false, force = false) => request<{ agents: Job<Application>[] }>('POST', `/api/applications/${enc(id)}/faculty-members`, { strong, force }),
  ask: (id: string, question: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/ask`, { question, strong }),
  requirements: (id: string) => request<Requirements>('GET', `/api/applications/${enc(id)}/requirements`),
  buildRequirementsMany: (ids: string[], strong = false) => request<{ agents: Job[] }>('POST', '/api/requirements/build', { ids, strong }),
  allRequirements: () => request<RequirementsRow[]>('GET', '/api/requirements'),
  buildRequirements: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/requirements`, { strong }),
  markRequirement: (id: string, key: string, patch: ReqMine) => request<Requirements>('PUT', `/api/applications/${enc(id)}/requirements/items/${encodeURIComponent(key)}`, patch),
  requirementSource: (id: string, n: number) => request<{ text: string }>('GET', `/api/applications/${enc(id)}/requirements/sources/${n}`),
  courseCheck: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/course-check`, { strong }),
  score: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/score`, { strong }),
  buildResume: (id: string, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/resume`, { strong }),
  resumeMaster: () => request<ResumeSection[]>('GET', '/api/resume/master'),
  resumePick: (id: string, sections: { id: string; entries: string[] }[]) => request<Application>('POST', `/api/applications/${enc(id)}/resume/pick`, { sections }),
  resumeEdit: (id: string, instruction: string, focus: string | null, strong = false) => request<Job<Application>>('POST', `/api/applications/${enc(id)}/resume/edit`, { instruction, focus, strong }),
  resumeRevert: (id: string, ids?: string[]) => request<Application>('POST', `/api/applications/${enc(id)}/resume/revert`, { ids }),
  essayPdf: (id: string, essay: string) => request<{ file: string; made_at: string }>('POST', `/api/applications/${enc(id)}/essays/${essay}/pdf`),
  essayPdfUrl: (id: string, essay: string, v?: string) => `/api/applications/${enc(id)}/essays/${essay}/pdf${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  resumePdfUrl: (id: string, v?: string) => `/api/applications/${enc(id)}/resume.pdf${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  finalFolder: (id: string) => request<FinalFolder>('GET', `/api/applications/${enc(id)}/final`),
  buildFinal: (id: string) => request<FinalFolder>('POST', `/api/applications/${enc(id)}/final`),
  openFinal: (id: string) => request<{ ok: boolean }>('POST', `/api/applications/${enc(id)}/final/open`),
  finalFileUrl: (id: string, name: string, v?: string) => `/api/applications/${enc(id)}/final/file/${encodeURIComponent(name)}${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  getEssay: (id: string, essay: string) => request<{ text: string; coach: string; comments: EssayComment[] }>('GET', `/api/applications/${enc(id)}/essays/${essay}`),
  saveEssay: (id: string, essay: string, text: string, comments?: EssayComment[]) =>
    request<{ ok: boolean; version: EssayVersion | null }>('PUT', `/api/applications/${enc(id)}/essays/${essay}`, comments ? { text, comments } : { text }),
  essayVersions: (id: string, essay: string) => request<EssayVersion[]>('GET', `/api/applications/${enc(id)}/essays/${essay}/versions`),
  essayVersion: (id: string, essay: string, v: string) => request<EssayVersion & { text: string }>('GET', `/api/applications/${enc(id)}/essays/${essay}/versions/${v}`),
  saveEssayVersion: (id: string, essay: string, label = '', text?: string) =>
    request<{ version: EssayVersion | null }>('POST', `/api/applications/${enc(id)}/essays/${essay}/versions`, { label, text }),
  renameEssayVersion: (id: string, essay: string, v: string, label: string) => request<EssayVersion>('PATCH', `/api/applications/${enc(id)}/essays/${essay}/versions/${v}`, { label }),
  deleteEssayVersion: (id: string, essay: string, v: string) => request<{ ok: boolean }>('DELETE', `/api/applications/${enc(id)}/essays/${essay}/versions/${v}`),
  restoreEssayVersion: (id: string, essay: string, v: string) => request<{ text: string }>('POST', `/api/applications/${enc(id)}/essays/${essay}/versions/${v}/restore`),
  essayOutline: (id: string, essay: string, strong = false) => request<Job<string>>('POST', `/api/applications/${enc(id)}/essays/${essay}/outline`, { strong }),
  essayReview: (id: string, essay: string, text: string, strong = false) => request<Job<string>>('POST', `/api/applications/${enc(id)}/essays/${essay}/review`, { text, strong }),
  getSop: (id: string) => request<{ text: string; coach: string }>('GET', `/api/applications/${enc(id)}/sop`),
  saveSop: (id: string, text: string) => request<{ ok: boolean }>('PUT', `/api/applications/${enc(id)}/sop`, { text }),
  sopOutline: (id: string, strong = false) => request<Job<string>>('POST', `/api/applications/${enc(id)}/sop/outline`, { strong }),
  sopReview: (id: string, text: string, strong = false) => request<Job<string>>('POST', `/api/applications/${enc(id)}/sop/review`, { text, strong }),
  discover: (query: string, kind: 'program' | 'scholarship', strong = false, count = 8) => request<Job<Candidate[]>>('POST', '/api/discover', { query, kind, strong, count }),
  discoverHistory: () => request<SavedSearch[]>('GET', '/api/discover/history'),
  forgetSearch: (index: number) => request<SavedSearch[]>('DELETE', `/api/discover/history/${index}`),
  job: <T>(id: string) => request<Job<T>>('GET', `/api/jobs/${id}`),
  jobs: () => request<Job[]>('GET', '/api/jobs'),
  cancelJob: (id: string) => request<Job>('POST', `/api/jobs/${id}/cancel`),
  agentsMeta: () => request<{ max_active: number; roles: Record<string, [Role, Building]> }>('GET', '/api/agents/meta'),
  fx: () => request<Fx>('GET', '/api/fx'),
  testsAsk: (note: string, readReports: boolean, strong = false) => request<Job<Profile>>('POST', '/api/tests/ask', { note, read_reports: readReports, strong }),
  profile: () => request<Profile>('GET', '/api/profile'),
  saveProfile: (p: Partial<Profile>) => request<Profile>('PUT', '/api/profile', p),
  recommenders: () => request<Recommender[]>('GET', '/api/recommenders'),
  saveRecommenderOrder: (ids: string[]) => request<Recommender[]>('PUT', '/api/recommenders/order', { ids }),
  removeRecommender: (rid: string) => request<Recommender[]>('DELETE', `/api/recommenders/${encodeURIComponent(rid)}`),
  letterEmail: (rid: string) => request<LetterEmail>('GET', `/api/recommenders/${encodeURIComponent(rid)}/email`),
  saveLetterEmail: (rid: string, subject: string, body: string) => request<LetterEmail>('PUT', `/api/recommenders/${encodeURIComponent(rid)}/email`, { subject, body }),
  draftLetterEmail: (rid: string, strong = false) => request<Job<LetterEmail>>('POST', `/api/recommenders/${encodeURIComponent(rid)}/email`, { strong }),
  documents: () => request<DocFile[]>('GET', '/api/documents'),
  courses: () => request<Courses>('GET', '/api/courses'),
  usage: () => request<(Usage & { at: string; kind: string; label: string })[]>('GET', '/api/usage'),
  fileUrl: (rel: string) => `/api/files/${enc(rel)}`,
}

export function waitForJob<T>(id: string, onUpdate?: (j: Job<T>) => void): Promise<Job<T>> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await api.job<T>(id)
        onUpdate?.(job)
        if (isActive(job)) setTimeout(tick, 1500)
        else resolve(job)
      } catch (e) {
        reject(e)
      }
    }
    tick()
  })
}

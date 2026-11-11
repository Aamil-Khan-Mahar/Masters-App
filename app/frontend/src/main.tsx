import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'

/** Redirect that keeps ?query, for old links like /calendar?… */
function KeepQuery({ to }: { to: string }) {
  return <Navigate to={to + useLocation().search} replace />
}
/** Old essay links (/essays?app=…&essay=…, /sop?app=…) open that statement in Apply. */
function EssayLink() {
  const [p] = useSearchParams()
  const app = p.get('app')
  return <Navigate to={app ? `/apply?app=${encodeURIComponent(app)}&item=${encodeURIComponent(`essay:${p.get('essay') ?? 'sop'}`)}` : '/apply'} replace />
}
import './index.css'
import { DataProvider } from './data'
import Layout from './components/Layout'
import ApplyLayout from './components/ApplyLayout'
import YouLayout from './components/YouLayout'
import Desk from './pages/Desk'
import Applications from './pages/Applications'
import Discover from './pages/Discover'
import Scholarships from './pages/Scholarships'
import ApplicationPage from './pages/ApplicationPage'
import Town from './pages/Town'
import Money from './pages/Money'
import Apply from './pages/Apply'
import UpNext from './pages/UpNext'
import Letters from './pages/Letters'
import Calendar from './pages/Calendar'
import Outcomes from './pages/Outcomes'
import ProfilePage from './pages/ProfilePage'
import Tests from './pages/Tests'
import Files from './pages/Files'
import Courses from './pages/Courses'
import Requirements from './pages/Requirements'
import { SetupGate } from './pages/Setup'

// Three areas that don't overlap: Research decides where to apply, Apply gets the applications done,
// You holds what describes the applicant (profile, tests, files) and is shared by both.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        {/* Until the data folder exists, the first-run setup stands in for every page. */}
        <SetupGate>
        <Routes>
          <Route path="apply" element={<ApplyLayout />}>
            <Route index element={<Apply />} />
            <Route path="next" element={<UpNext />} />
            <Route path="letters" element={<Letters />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="outcomes" element={<Outcomes />} />
          </Route>
          <Route path="you" element={<YouLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="tests" element={<Tests />} />
            <Route path="courses" element={<Courses />} />
            <Route path="files" element={<Files />} />
          </Route>
          <Route element={<Layout />}>
            <Route index element={<Desk />} />
            <Route path="discover" element={<Discover />} />
            <Route path="applications" element={<Applications />} />
            <Route path="scholarships" element={<Scholarships />} />
            <Route path="money" element={<Money />} />
            <Route path="requirements" element={<Requirements />} />
            <Route path="town" element={<Town />} />
            <Route path="app/*" element={<ApplicationPage />} />
            {/* old addresses */}
            <Route path="calendar" element={<Navigate to="/apply/calendar" replace />} />
            <Route path="essays" element={<EssayLink />} />
            <Route path="sop" element={<EssayLink />} />
            <Route path="recommenders" element={<Navigate to="/apply/letters" replace />} />
            <Route path="documents" element={<Navigate to="/you/files" replace />} />
            <Route path="tests" element={<KeepQuery to="/you/tests" />} />
            <Route path="profile" element={<Navigate to="/you/profile" replace />} />
            <Route path="programs" element={<Navigate to="/applications" replace />} />
            <Route path="pipeline" element={<Navigate to="/applications?view=board" replace />} />
            <Route path="shortlist" element={<Navigate to="/applications?view=compare" replace />} />
            <Route path="research" element={<Navigate to="/discover" replace />} />
          </Route>
        </Routes>
        </SetupGate>
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
)

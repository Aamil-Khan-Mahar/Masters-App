import { useEffect, useState } from 'react'
import { api, type DocFile } from '../api'
import { formatDate } from '../lib'
import { ExternalLink, PageHeader, Section } from '../components/ui'

/** Your own files under Common/: CVs, transcript, score reports. What each application needs is in Apply's Documents folder. */
export default function Files() {
  const [files, setFiles] = useState<DocFile[]>([])
  useEffect(() => {
    api.documents().then(setFiles).catch(() => undefined)
  }, [])
  const folders = [...new Set(files.map((f) => f.folder))]

  return (
    <>
      <PageHeader title="Files" subtitle="Everything under Common/: your resumes, transcript and score reports. Each application's document list is in Apply." />
      <Section title="Your files" count={files.length} aside={<span className="text-muted">in Common/</span>}>
        {files.length === 0 ? (
          <p className="py-3 text-sm text-muted">No files found under Common/.</p>
        ) : (
          <div className="grid gap-x-14 gap-y-6 pt-2 lg:grid-cols-2 3xl:grid-cols-3">
            {folders.map((f) => (
              <div key={f}>
                <div className="mb-1 text-sm text-muted">{f.replace(/\//g, ', ')}</div>
                <ul className="divide-y divide-line">
                  {files
                    .filter((d) => d.folder === f)
                    .map((d) => (
                      <li key={d.path} className="flex items-center gap-3 py-2">
                        <ExternalLink href={api.fileUrl(d.path)} className="min-w-0 flex-1 text-sm">
                          {d.name}
                        </ExternalLink>
                        <span className="num shrink-0 text-xs text-muted">{formatDate(d.modified.slice(0, 10))}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

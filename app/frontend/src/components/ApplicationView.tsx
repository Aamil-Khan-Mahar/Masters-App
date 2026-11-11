import { Button, Markdown } from './ui'
import type { Application } from '../api'

/** Read-only notes and research (the README body). */
export function NotesView({ app, onEdit }: { app: Application; onEdit: () => void }) {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit notes
        </Button>
      </div>
      <div className="max-w-[80ch]">
        <Markdown>{app.body || '_No notes yet._'}</Markdown>
      </div>
    </div>
  )
}

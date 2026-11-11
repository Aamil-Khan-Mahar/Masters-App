import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Application } from '../api'
import { useData } from '../data'
import { appPath } from '../lib'
import { Button, Input, Label, Modal } from './ui'

/** Modal for manually adding a program or scholarship. */
export default function NewApplication({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: 'program' | 'scholarship' }) {
  const { replaceApp, toast } = useData()
  const navigate = useNavigate()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const fields =
    kind === 'program'
      ? [
          ['name', 'Program name', 'Master of Science (MSc) in Computer Science'],
          ['university', 'University', 'Example University'],
          ['country', 'Country', 'Canada'],
          ['city', 'City', 'Montreal'],
          ['degree', 'Degree', 'MSc'],
          ['url', 'Official page', 'https://…'],
        ]
      : [
          ['name', 'Scholarship name', 'Chevening Scholarships'],
          ['provider', 'Provider', 'UK FCDO'],
          ['country', 'Host country', 'United Kingdom'],
          ['url', 'Official page', 'https://…'],
        ]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await api.create({ kind, ...form } as Partial<Application>)
      replaceApp(created)
      toast(`Added ${created.name}`)
      setForm({})
      onClose()
      navigate(appPath(created))
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={kind === 'program' ? 'Add program' : 'Add scholarship'}>
      <form onSubmit={submit} className="space-y-3">
        {fields.map(([k, label, ph]) => (
          <div key={k}>
            <Label>{label}</Label>
            <Input value={form[k] ?? ''} onChange={set(k)} placeholder={ph} required={['name', 'university', 'country'].includes(k) && (kind === 'program' || k === 'name')} />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  )
}

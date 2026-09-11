import { useEffect, useRef, useState } from 'react'
import { api, type ControlledDocumentDetail, type DocumentStatus } from '../api.ts'

type Props = {
  documentId: string
  onTitleChange: (title: string) => void
  onOpenDocument: (id: string, title: string, folderId: string) => void
}

const STATUS_ACTIONS: Array<{ from: DocumentStatus; to: DocumentStatus; label: string }> = [
  { from: 'draft', to: 'in_review', label: 'Submit for review' },
  { from: 'in_review', to: 'draft', label: 'Return to draft' },
  { from: 'in_review', to: 'effective', label: 'Release' },
  { from: 'effective', to: 'obsolete', label: 'Obsolete' },
]

export function DocumentView({ documentId, onTitleChange, onOpenDocument }: Props) {
  const [doc, setDoc] = useState<ControlledDocumentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<ControlledDocumentDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getDocument(documentId)
      .then((payload) => {
        if (cancelled) return
        setDoc(payload)
        latest.current = payload
        onTitleChangeRef.current(`${payload.number} Rev ${payload.revision}`)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [documentId])

  const locked = doc?.status === 'effective' || doc?.status === 'obsolete'

  function queueSave(next: ControlledDocumentDetail) {
    latest.current = next
    if (locked) return
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveDocument(current.id, {
          title: current.title,
          number: current.number,
          revision: current.revision,
          body: current.body,
          trainingRoles: current.trainingRoles,
        })
        .then((saved) => {
          setSaveState('saved')
          onTitleChangeRef.current(`${saved.number} Rev ${saved.revision}`)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<ControlledDocumentDetail>) {
    setDoc((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function changeStatus(status: DocumentStatus) {
    if (!doc) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.setDocumentStatus(doc.id, status)
      setDoc(updated)
      latest.current = updated
      onTitleChangeRef.current(`${updated.number} Rev ${updated.revision}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed')
    } finally {
      setBusy(false)
    }
  }

  async function revise() {
    if (!doc) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.reviseDocument(doc.id)
      onOpenDocument(next.id, `${next.number} Rev ${next.revision}`, next.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create revision')
    } finally {
      setBusy(false)
    }
  }

  if (error && !doc) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="folder-view">
        <p className="muted">Loading controlled document…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Controlled document · ISO 9001:2015 7.5 Documented information</p>
        <div className="dual-toolbar">
          <h1>
            {doc.number}{' '}
            <span className={`pill status-${doc.status}`}>{doc.status.replace('_', ' ')}</span>
          </h1>
          <p className="save-state">
            {locked ? 'Read-only' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <p className="muted">Required fields marked *. Title, number, and revision identify the controlled copy.</p>
        {doc.training ? (
          <p className="muted">
            Outstanding training: <strong>{doc.training.pending}</strong>
            {doc.training.complete || doc.training.stale
              ? ` · ${doc.training.complete} complete · ${doc.training.stale} stale`
              : null}
          </p>
        ) : null}
        <div className="status-actions">
          {STATUS_ACTIONS.filter((action) => action.from === doc.status).map((action) => (
            <button
              key={action.to}
              type="button"
              className={action.to === 'effective' ? 'primary' : undefined}
              disabled={busy}
              onClick={() => void changeStatus(action.to)}
            >
              {action.label}
            </button>
          ))}
          {doc.status === 'effective' || doc.status === 'obsolete' ? (
            <button type="button" disabled={busy} onClick={() => void revise()}>
              New revision
            </button>
          ) : null}
        </div>
      </header>

      <div className="doc-meta">
        <label>
          Title
          <span className="req"> *</span>
          <input
            value={doc.title}
            disabled={locked}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        <label>
          Number
          <span className="req"> *</span>
          <input
            value={doc.number}
            disabled={locked}
            onChange={(event) => patch({ number: event.target.value })}
          />
        </label>
        <label>
          Revision
          <span className="req"> *</span>
          <input
            value={doc.revision}
            disabled={locked}
            onChange={(event) => patch({ revision: event.target.value })}
          />
        </label>
        <label>
          Effective date
          <input value={doc.effectiveDate ?? ''} disabled />
        </label>
        <label>
          Train departments
          <input
            value={doc.trainingRoles ?? ''}
            disabled={locked}
            placeholder="Blank = all users. Example: Quality, Production"
            onChange={(event) => patch({ trainingRoles: event.target.value })}
          />
        </label>
      </div>

      <label className="doc-body">
        Body
        <textarea
          rows={18}
          value={doc.body}
          disabled={locked}
          placeholder="Procedure / work instruction text. This is the controlled body for this revision."
          onChange={(event) => patch({ body: event.target.value })}
        />
      </label>
    </div>
  )
}

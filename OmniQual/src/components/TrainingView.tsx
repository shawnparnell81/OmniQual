import { useEffect, useRef, useState } from 'react'
import { api, type TrainingAssignmentSummary } from '../api.ts'

type Props = {
  trainingId: string
  currentUserId: string
  onTitleChange: (title: string) => void
  onOpenDocument: (id: string, title: string, folderId: string) => void
}

export function TrainingView({ trainingId, currentUserId, onTitleChange, onOpenDocument }: Props) {
  const [assignment, setAssignment] = useState<TrainingAssignmentSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getTraining(trainingId)
      .then((payload) => {
        if (cancelled) return
        setAssignment(payload)
        onTitleChangeRef.current(`${payload.documentNumber} Rev ${payload.revision}`)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load assignment')
      })
    return () => {
      cancelled = true
    }
  }, [trainingId])

  async function complete() {
    if (!assignment) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.completeTraining(assignment.id)
      setAssignment(updated)
      onTitleChange(`${updated.documentNumber} Rev ${updated.revision}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete training')
    } finally {
      setBusy(false)
    }
  }

  if (error && !assignment) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!assignment) {
    return (
      <div className="folder-view">
        <p className="muted">Loading training assignment…</p>
      </div>
    )
  }

  const mine = assignment.userId === currentUserId
  const canComplete = mine && assignment.status === 'pending'

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Competence record · ISO 9001:2015 7.2</p>
        <div className="dual-toolbar">
          <h1>
            {assignment.documentNumber} Rev {assignment.revision}{' '}
            <span className={`pill status-${assignment.status}`}>{assignment.status}</span>
          </h1>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <p>
          {assignment.documentTitle} — assigned to {assignment.userName}.
        </p>
        {assignment.status === 'stale' ? (
          <p className="muted">
            A newer revision of this document was released. Complete the current assignment instead.
          </p>
        ) : null}
        {assignment.status === 'complete' && assignment.completedAt ? (
          <p className="muted">
            Acknowledged {new Date(assignment.completedAt).toLocaleString()}.
          </p>
        ) : null}
        <div className="status-actions">
          <button
            type="button"
            onClick={() =>
              onOpenDocument(
                assignment.documentId,
                `${assignment.documentNumber} Rev ${assignment.revision}`,
                '',
              )
            }
          >
            Open document
          </button>
          {canComplete ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void complete()}>
              {busy ? 'Saving…' : 'Acknowledge current revision'}
            </button>
          ) : null}
          {!mine ? <p className="muted">Only {assignment.userName} can mark this complete.</p> : null}
        </div>
        <p className="iso-help">
          Classroom or session attendance is recorded on the Training → Attendance form (ISO 9001:2015 7.2).
        </p>
      </header>
    </div>
  )
}

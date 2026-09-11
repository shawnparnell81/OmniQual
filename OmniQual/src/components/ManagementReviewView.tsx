import { useEffect, useRef, useState } from 'react'
import { api, type ManagementReviewDetail, type ReviewStatus } from '../api.ts'
import { LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  reviewId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function ManagementReviewView({ reviewId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [review, setReview] = useState<ManagementReviewDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<ManagementReviewDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getReview(reviewId)
      .then((payload) => {
        if (cancelled) return
        setReview(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load review')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [reviewId])

  function queueSave(next: ManagementReviewDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveReview(current.id, {
          number: current.number,
          meetingDate: current.meetingDate ?? '',
          attendees: current.attendees,
          inputsSummary: current.inputsSummary,
          outputsActions: current.outputsActions,
        })
        .then((saved) => {
          setSaveState('saved')
          onTitleChangeRef.current(saved.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<ManagementReviewDetail>) {
    setReview((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function changeStatus(status: ReviewStatus) {
    if (!review) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.setReviewStatus(review.id, status)
      setReview(updated)
      latest.current = updated
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed')
    } finally {
      setBusy(false)
    }
  }

  async function spawnCapa() {
    if (!review) return
    setBusy(true)
    setError(null)
    try {
      const record = await api.createReviewLinkedRecord(review.id)
      const refreshed = await api.getReview(review.id)
      setReview(refreshed)
      onOpenRecord(record.id, record.title, record.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked CAPA')
    } finally {
      setBusy(false)
    }
  }

  if (error && !review) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="folder-view">
        <p className="muted">Loading management review…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Management review · ISO 9001:2015 9.3</p>
        <div className="dual-toolbar">
          <h1>
            {review.number} <span className={`pill status-${review.status}`}>{review.status}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">Required fields marked *. Inputs and outputs of the review are recorded here (9.3.2 / 9.3.3).</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          <button
            type="button"
            className={review.status === 'draft' ? 'primary' : undefined}
            disabled={busy || review.status === 'draft'}
            onClick={() => void changeStatus('draft')}
          >
            Draft
          </button>
          <button
            type="button"
            className={review.status === 'completed' ? 'primary' : undefined}
            disabled={busy || review.status === 'completed'}
            onClick={() => void changeStatus('completed')}
          >
            Completed
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void spawnCapa()}>
            Create linked CAPA
          </button>
        </div>
        <LinkedRecords items={review.related} onOpen={onOpenLinked} />
      </header>

      <div className="doc-meta audit-meta">
        <label>
          Number
          <span className="req"> *</span>
          <input value={review.number} onChange={(event) => patch({ number: event.target.value })} />
        </label>
        <label>
          Meeting date
          <span className="req"> *</span>
          <input
            type="date"
            value={review.meetingDate ?? ''}
            onChange={(event) => patch({ meetingDate: event.target.value || null })}
          />
        </label>
      </div>
      <label className="doc-body">
        Attendees
        <textarea
          rows={3}
          value={review.attendees}
          placeholder="Names and roles present"
          onChange={(event) => patch({ attendees: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Inputs summary
        <textarea
          rows={6}
          value={review.inputsSummary}
          placeholder="Audit results, customer feedback, process performance, CAPA status, risks and opportunities."
          onChange={(event) => patch({ inputsSummary: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Outputs / actions
        <textarea
          rows={6}
          value={review.outputsActions}
          placeholder="Decisions, resource needs, and improvement actions. Create a linked CAPA from an action."
          onChange={(event) => patch({ outputsActions: event.target.value })}
        />
      </label>
    </div>
  )
}

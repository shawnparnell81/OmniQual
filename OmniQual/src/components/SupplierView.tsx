import { useEffect, useRef, useState } from 'react'
import { api, type SupplierDetail, type SupplierEvalResult, type SupplierStatus } from '../api.ts'
import { LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  supplierId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function SupplierView({ supplierId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const [evalDate, setEvalDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [evalResult, setEvalResult] = useState<SupplierEvalResult>('pass')
  const [evalScore, setEvalScore] = useState('')
  const [evalComments, setEvalComments] = useState('')
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<SupplierDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getSupplier(supplierId)
      .then((payload) => {
        if (cancelled) return
        setSupplier(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load supplier')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [supplierId])

  function queueSave(next: SupplierDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveSupplier(current.id, {
          name: current.name,
          number: current.number,
          notes: current.notes,
          status: current.status,
        })
        .then((saved) => {
          setSaveState('saved')
          onTitleChangeRef.current(saved.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<SupplierDetail>) {
    setSupplier((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function recordEvaluation() {
    if (!supplier) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.recordSupplierEvaluation(supplier.id, {
        date: evalDate,
        result: evalResult,
        score: evalScore ? Number.parseInt(evalScore, 10) : null,
        comments: evalComments,
      })
      setSupplier(updated)
      latest.current = updated
      setEvalComments('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record evaluation')
    } finally {
      setBusy(false)
    }
  }

  async function spawn(type: 'ncr' | 'capa') {
    if (!supplier) return
    setBusy(true)
    setError(null)
    try {
      const record = await api.createSupplierLinkedRecord(supplier.id, type)
      const refreshed = await api.getSupplier(supplier.id)
      setSupplier(refreshed)
      onOpenRecord(record.id, record.title, record.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked record')
    } finally {
      setBusy(false)
    }
  }

  if (error && !supplier) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="folder-view">
        <p className="muted">Loading supplier…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Supplier quality · ISO 9001:2015 8.4 Control of externally provided processes</p>
        <div className="dual-toolbar">
          <h1>
            {supplier.number}{' '}
            <span className={`pill status-${supplier.status}`}>{supplier.status}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">Required fields marked *. Evaluation date and result are required when recording an evaluation.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          {(['approved', 'conditional', 'disqualified'] as SupplierStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={supplier.status === status ? 'primary' : undefined}
              disabled={busy || supplier.status === status}
              onClick={() => patch({ status })}
            >
              {status}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => void spawn('ncr')}>
            Create linked NCR
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void spawn('capa')}>
            Create linked CAPA
          </button>
        </div>
        <LinkedRecords items={supplier.related} onOpen={onOpenLinked} />
      </header>

      <div className="doc-meta audit-meta">
        <label>
          Name
          <span className="req"> *</span>
          <input value={supplier.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label>
          Number
          <span className="req"> *</span>
          <input value={supplier.number} onChange={(event) => patch({ number: event.target.value })} />
        </label>
        <label>
          Last evaluation
          <input value={supplier.lastEvaluationDate ?? ''} disabled />
        </label>
      </div>
      <label className="doc-body">
        Notes
        <textarea rows={4} value={supplier.notes} onChange={(event) => patch({ notes: event.target.value })} />
      </label>

      <h2>Record evaluation</h2>
      <div className="doc-meta audit-meta">
        <label>
          Date
          <span className="req"> *</span>
          <input type="date" value={evalDate} onChange={(event) => setEvalDate(event.target.value)} />
        </label>
        <label>
          Result
          <span className="req"> *</span>
          <select
            value={evalResult}
            onChange={(event) => setEvalResult(event.target.value as SupplierEvalResult)}
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="conditional">Conditional</option>
          </select>
        </label>
        <label>
          Score
          <input value={evalScore} placeholder="0–100" onChange={(event) => setEvalScore(event.target.value)} />
        </label>
      </div>
      <label className="doc-body">
        Comments
        <textarea rows={3} value={evalComments} onChange={(event) => setEvalComments(event.target.value)} />
      </label>
      <div className="status-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void recordEvaluation()}>
          {busy ? 'Saving…' : 'Save evaluation'}
        </button>
      </div>

      <h2>History</h2>
      {supplier.evaluations.length === 0 ? (
        <p className="muted">No evaluations yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th>Date</th>
              <th>Result</th>
              <th>Score</th>
              <th>Comments</th>
            </tr>
          </thead>
          <tbody>
            {supplier.evaluations.map((item) => (
              <tr key={item.id}>
                <td>{item.evalDate}</td>
                <td>
                  <span className={`pill status-${item.result}`}>{item.result}</span>
                </td>
                <td>{item.score ?? '—'}</td>
                <td>{item.comments || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

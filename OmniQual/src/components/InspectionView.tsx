import { useEffect, useRef, useState } from 'react'
import { api, type InspectionDetail, type InspectionResult } from '../api.ts'
import { AttachExisting } from './AttachExisting.tsx'
import { LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  inspectionId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function InspectionView({ inspectionId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [record, setRecord] = useState<InspectionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<InspectionDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getInspection(inspectionId)
      .then((payload) => {
        if (cancelled) return
        setRecord(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load inspection')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [inspectionId])

  function queueSave(next: InspectionDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveInspection(current.id, {
          title: current.title,
          area: current.area,
          inspector: current.inspector,
          inspectedAt: current.inspectedAt ?? '',
          result: current.result,
          notes: current.notes,
        })
        .then(async (saved) => {
          setSaveState('saved')
          const fresh = saved.result === 'fail' ? await api.getInspection(saved.id) : saved
          setRecord(fresh)
          latest.current = fresh
          onTitleChangeRef.current(fresh.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<InspectionDetail>) {
    setRecord((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function spawn(type: 'ncr' | 'capa' | 'discrepancy') {
    if (!record) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createInspectionLinkedRecord(record.id, type)
      const refreshed = await api.getInspection(record.id)
      setRecord(refreshed)
      latest.current = refreshed
      if (type === 'discrepancy') {
          onOpenLinked({
            id: created.id,
            kind: 'discrepancy',
            title: created.title || created.id,
            status: created.status,
            folderId: created.folderId,
            discrepancyId: created.id,
          })
      } else {
        onOpenRecord(created.id, created.title, created.folderId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked record')
    } finally {
      setBusy(false)
    }
  }

  if (error && !record) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!record) {
    return (
      <div className="folder-view">
        <p className="muted">Loading inspection…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Inspection · ISO 9001:2015 8.5 / 8.6 / 8.7</p>
        <div className="dual-toolbar">
          <h1>
            {record.number}{' '}
            <span className={`pill status-${record.result}`}>{record.result}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">Required fields marked *. A failed result opens a Discrepancy Investigation and can spawn an NCR.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          <button type="button" disabled={busy} onClick={() => void spawn('ncr')}>
            Create linked NCR
          </button>
          <AttachExisting
            type="ncr"
            sourceKind="inspection"
            sourceId={record.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getInspection(record.id)
              setRecord(refreshed)
              latest.current = refreshed
            }}
          />
          <button type="button" disabled={busy} onClick={() => void spawn('discrepancy')}>
            Create linked DI
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void spawn('capa')}>
            Create linked CAPA
          </button>
          <AttachExisting
            type="capa"
            sourceKind="inspection"
            sourceId={record.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getInspection(record.id)
              setRecord(refreshed)
              latest.current = refreshed
            }}
          />
        </div>
        <LinkedRecords items={record.related} onOpen={onOpenLinked} />
      </header>

      <div className="doc-meta audit-meta">
        <label>
          Title
          <span className="req"> *</span>
          <input value={record.title} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <label>
          Area / process
          <input value={record.area} onChange={(event) => patch({ area: event.target.value })} />
        </label>
        <label>
          Inspector
          <span className="req"> *</span>
          <input value={record.inspector} onChange={(event) => patch({ inspector: event.target.value })} />
        </label>
        <label>
          Inspected
          <input
            type="date"
            value={record.inspectedAt ?? ''}
            onChange={(event) => patch({ inspectedAt: event.target.value || null })}
          />
        </label>
        <label>
          Result
          <span className="req"> *</span>
          <select
            value={record.result}
            onChange={(event) => patch({ result: event.target.value as InspectionResult })}
          >
            <option value="pending">Pending</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
        </label>
      </div>
      <label className="doc-body">
        Notes
        <textarea rows={6} value={record.notes} onChange={(event) => patch({ notes: event.target.value })} />
      </label>
    </div>
  )
}

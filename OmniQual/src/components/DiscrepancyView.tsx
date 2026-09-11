import { useEffect, useRef, useState } from 'react'
import { api, type DiscrepancyDetail } from '../api.ts'
import { AttachExisting } from './AttachExisting.tsx'
import { LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  discrepancyId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function DiscrepancyView({ discrepancyId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [record, setRecord] = useState<DiscrepancyDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<DiscrepancyDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getDiscrepancy(discrepancyId)
      .then((payload) => {
        if (cancelled) return
        setRecord(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load discrepancy')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [discrepancyId])

  function queueSave(next: DiscrepancyDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveDiscrepancy(current.id, {
          identification: current.identification,
          containment: current.containment,
          investigation: current.investigation,
          disposition: current.disposition,
        })
        .then((saved) => {
          setSaveState('saved')
          onTitleChangeRef.current(saved.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<DiscrepancyDetail>) {
    setRecord((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function setStatus(status: string) {
    if (!record) return
    setBusy(true)
    setError(null)
    try {
      const saved = await api.saveDiscrepancy(record.id, { status })
      setRecord(saved)
      latest.current = saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status')
    } finally {
      setBusy(false)
    }
  }

  async function spawn(type: 'ncr' | 'capa') {
    if (!record) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createDiscrepancyLinkedRecord(record.id, type)
      const refreshed = await api.getDiscrepancy(record.id)
      setRecord(refreshed)
      latest.current = refreshed
      onOpenRecord(created.id, created.title, created.folderId)
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
        <p className="muted">Loading discrepancy investigation…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Discrepancy investigation · ISO 9001:2015 8.7 / 10.2</p>
        <div className="dual-toolbar">
          <h1>
            {record.number} <span className={`pill status-${record.status}`}>{record.status}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">Required fields marked *. Nonconformity, correction, and disposition stay linked to the source finding, NCR, and CAPA.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          <button
            type="button"
            className={record.status === 'open' ? 'primary' : undefined}
            disabled={busy || record.status === 'open'}
            onClick={() => void setStatus('open')}
          >
            Open
          </button>
          <button
            type="button"
            disabled={busy || record.status === 'closed'}
            onClick={() => void setStatus('closed')}
          >
            Closed
          </button>
          <button type="button" disabled={busy} onClick={() => void spawn('ncr')}>
            Create NCR
          </button>
          <AttachExisting
            type="ncr"
            sourceKind="discrepancy"
            sourceId={record.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getDiscrepancy(record.id)
              setRecord(refreshed)
              latest.current = refreshed
            }}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void spawn('capa')}>
            Create CAPA
          </button>
          <AttachExisting
            type="capa"
            sourceKind="discrepancy"
            sourceId={record.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getDiscrepancy(record.id)
              setRecord(refreshed)
              latest.current = refreshed
            }}
          />
        </div>
        <LinkedRecords items={record.related} onOpen={onOpenLinked} />
      </header>

      <label className="doc-body">
        Identification of nonconformity
        <span className="req"> *</span>
        <textarea
          rows={4}
          value={record.identification}
          placeholder="What is nonconforming, where it was found, and which ISO clause applies."
          onChange={(event) => patch({ identification: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Containment / correction (8.7)
        <span className="req"> *</span>
        <textarea
          rows={4}
          value={record.containment}
          placeholder="Immediate action to contain the discrepancy and protect product or process."
          onChange={(event) => patch({ containment: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Investigation (10.2)
        <textarea
          rows={5}
          value={record.investigation}
          placeholder="Facts, extent, and likely causes. Link a CAPA when corrective action is required."
          onChange={(event) => patch({ investigation: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Disposition
        <textarea
          rows={4}
          value={record.disposition}
          placeholder="Use-as-is, rework, scrap, or other disposition of the nonconforming output."
          onChange={(event) => patch({ disposition: event.target.value })}
        />
      </label>
    </div>
  )
}

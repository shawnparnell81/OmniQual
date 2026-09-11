import { useEffect, useRef, useState } from 'react'
import { api, type CalibrationDetail, type CalibrationEventResult } from '../api.ts'
import { AttachExisting } from './AttachExisting.tsx'
import { calStatusLabel, LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  assetId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function CalibrationView({ assetId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [asset, setAsset] = useState<CalibrationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eventResult, setEventResult] = useState<CalibrationEventResult>('in_tolerance')
  const [eventNotes, setEventNotes] = useState('')
  const [asFound, setAsFound] = useState('')
  const [asLeft, setAsLeft] = useState('')
  const [technician, setTechnician] = useState('')
  const [certificate, setCertificate] = useState('')
  const [ootNcrOffered, setOotNcrOffered] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<CalibrationDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    setOotNcrOffered(false)
    api
      .getCalibration(assetId)
      .then((payload) => {
        if (cancelled) return
        setAsset(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load asset')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [assetId])

  function queueSave(next: CalibrationDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveCalibration(current.id, {
          name: current.name,
          number: current.number,
          location: current.location,
          intervalDays: current.intervalDays,
        })
        .then((saved) => {
          setSaveState('saved')
          setAsset((present) =>
            present && present.id === saved.id
              ? { ...present, status: saved.status, nextDue: saved.nextDue, intervalDays: saved.intervalDays }
              : present,
          )
          latest.current = saved
          onTitleChangeRef.current(saved.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<CalibrationDetail>) {
    setAsset((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function recordEvent() {
    if (!asset) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.recordCalibrationEvent(asset.id, {
        date: eventDate,
        result: eventResult,
        notes: eventNotes,
        asFound,
        asLeft,
        technician,
        certificate,
      })
      setAsset(updated)
      latest.current = updated
      setEventNotes('')
      setAsFound('')
      setAsLeft('')
      setCertificate('')
      if (eventResult === 'out_of_tolerance') setOotNcrOffered(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record calibration')
    } finally {
      setBusy(false)
    }
  }

  async function spawnNcr() {
    if (!asset) return
    setBusy(true)
    setError(null)
    try {
      const record = await api.createCalibrationLinkedRecord(asset.id)
      const refreshed = await api.getCalibration(asset.id)
      setAsset(refreshed)
      latest.current = refreshed
      setOotNcrOffered(false)
      onOpenRecord(record.id, record.title, record.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked NCR')
    } finally {
      setBusy(false)
    }
  }

  async function setHold(status: 'out_of_service' | 'in_service') {
    if (!asset) return
    setBusy(true)
    setError(null)
    try {
      const saved = await api.saveCalibration(asset.id, { status })
      setAsset(saved)
      latest.current = saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update service hold')
    } finally {
      setBusy(false)
    }
  }

  if (error && !asset) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="folder-view">
        <p className="muted">Loading calibration asset…</p>
      </div>
    )
  }

  const months = (asset.intervalDays / 30).toFixed(1).replace(/\.0$/, '')
  const linkedNcr = asset.related.find((item) => item.kind === 'ncr') ?? asset.links[0]

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Calibration · ISO 9001:2015 7.1.5 Monitoring and measuring resources</p>
        <div className="dual-toolbar">
          <h1>
            {asset.number}{' '}
            <span className={`pill status-${asset.status}`}>{calStatusLabel(asset.status)}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">
          Required fields marked *. Status is computed from interval, last calibration, and today. Out of service is a
          hold until the asset is returned to service.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          {asset.status === 'out_of_service' ? (
            <button type="button" className="primary" disabled={busy} onClick={() => void setHold('in_service')}>
              Return to service
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void setHold('out_of_service')}>
              Place out of service
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void spawnNcr()}>
            {linkedNcr ? 'Open linked NCR' : 'Create linked NCR'}
          </button>
          <AttachExisting
            type="ncr"
            sourceKind="calibration"
            sourceId={asset.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getCalibration(asset.id)
              setAsset(refreshed)
              latest.current = refreshed
            }}
          />
        </div>
        {ootNcrOffered ? (
          <p className="iso-help">
            Out-of-tolerance result placed this asset out of service (7.1.5). A linked NCR was created or reused — open
            it from Linked records, or use the button above.
          </p>
        ) : null}
        <LinkedRecords items={asset.related} onOpen={onOpenLinked} />
      </header>

      <div className="doc-meta audit-meta">
        <label>
          Name
          <span className="req"> *</span>
          <input value={asset.name} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label>
          Number
          <span className="req"> *</span>
          <input value={asset.number} onChange={(event) => patch({ number: event.target.value })} />
        </label>
        <label>
          Location
          <input value={asset.location} onChange={(event) => patch({ location: event.target.value })} />
        </label>
        <label>
          Interval (days)
          <span className="req"> *</span>
          <input
            type="number"
            min={1}
            value={asset.intervalDays}
            onChange={(event) => patch({ intervalDays: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })}
          />
        </label>
        <label>
          Last calibrated
          <input value={asset.lastCalibrated ?? ''} disabled />
        </label>
        <label>
          Next due
          <input value={asset.nextDue ?? ''} disabled />
        </label>
      </div>
      <p className="iso-help">
        Every {asset.intervalDays} days (≈ {months} months). Next due = last calibration date + interval. Status
        recalculates whenever this asset is opened or listed.
      </p>

      <h2>Record calibration</h2>
      <p className="muted">Recording an event sets next due to the event date plus the interval (ISO 9001:2015 7.1.5).</p>
      <div className="doc-meta audit-meta">
        <label>
          Date
          <span className="req"> *</span>
          <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>
        <label>
          Result
          <span className="req"> *</span>
          <select
            value={eventResult}
            onChange={(event) => setEventResult(event.target.value as CalibrationEventResult)}
          >
            <option value="in_tolerance">In tolerance</option>
            <option value="out_of_tolerance">Out of tolerance</option>
            <option value="limited">Limited</option>
          </select>
        </label>
        <label>
          Technician
          <input value={technician} onChange={(event) => setTechnician(event.target.value)} />
        </label>
        <label>
          Certificate
          <input value={certificate} onChange={(event) => setCertificate(event.target.value)} />
        </label>
        <label>
          As found
          <input value={asFound} onChange={(event) => setAsFound(event.target.value)} />
        </label>
        <label>
          As left
          <input value={asLeft} onChange={(event) => setAsLeft(event.target.value)} />
        </label>
      </div>
      <label className="doc-body">
        Notes
        <textarea rows={3} value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} />
      </label>
      <div className="status-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void recordEvent()}>
          {busy ? 'Saving…' : 'Save calibration event'}
        </button>
      </div>

      <h2>History</h2>
      {asset.events.length === 0 ? (
        <p className="muted">No calibration events yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th>Date</th>
              <th>Result</th>
              <th>Technician</th>
              <th>Certificate</th>
              <th>As found / as left</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {asset.events.map((item) => (
              <tr key={item.id}>
                <td>{item.eventDate}</td>
                <td>
                  <span className={`pill status-${item.result}`}>{item.result.replaceAll('_', ' ')}</span>
                </td>
                <td>{item.technician || '—'}</td>
                <td>{item.certificate || '—'}</td>
                <td>
                  {item.asFound || item.asLeft ? `${item.asFound || '—'} → ${item.asLeft || '—'}` : '—'}
                </td>
                <td>{item.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

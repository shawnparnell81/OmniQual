import { useEffect, useRef, useState } from 'react'
import { api, type FormRecordSummary } from '../api.ts'

type SourceKind = 'discrepancy' | 'audit' | 'calibration' | 'inspection' | 'ncr'

type Props = {
  type: 'ncr' | 'capa'
  sourceKind: SourceKind
  sourceId: string
  disabled?: boolean
  onAttached: (record: FormRecordSummary) => void | Promise<void>
  onError: (message: string) => void
}

export function AttachExisting({ type, sourceKind, sourceId, disabled, onAttached, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<FormRecordSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const label = type === 'ncr' ? 'NCR' : 'CAPA'

  useEffect(() => {
    if (!open) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api
        .searchRecords({ type, q, sourceKind, sourceId })
        .then((payload) => setHits(payload.records))
        .catch((err: unknown) => {
          onErrorRef.current(err instanceof Error ? err.message : 'Search failed')
        })
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [open, q, type, sourceKind, sourceId])

  async function attach(record: FormRecordSummary) {
    setBusy(true)
    try {
      await api.attachRecord({ type, recordId: record.id, sourceKind, sourceId })
      await onAttached(record)
      setOpen(false)
      setQ('')
      setHits([])
    } catch (err) {
      onError(err instanceof Error ? err.message : `Could not attach ${label}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="attach-picker">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setOpen((current) => {
            const next = !current
            if (next) setLoading(true)
            else {
              setQ('')
              setHits([])
              setLoading(false)
            }
            return next
          })
        }}
      >
        Attach existing {label}
      </button>
      {open ? (
        <div className="attach-panel">
          <input
            autoFocus
            value={q}
            placeholder={`Search ${label} by number or title`}
            disabled={busy}
            onChange={(event) => setQ(event.target.value)}
          />
          {loading ? <p className="muted">Searching…</p> : null}
          {!loading && hits.length === 0 ? (
            <p className="muted">No matching open or draft {label}s.</p>
          ) : null}
          <ul className="attach-results">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="attach-hit" disabled={busy} onClick={() => void attach(hit)}>
                  <span>{hit.title}</span>
                  <span className={`pill status-${hit.status}`}>{hit.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

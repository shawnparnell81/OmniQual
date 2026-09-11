import { useEffect, useRef, useState } from 'react'
import { api, type AuditStatus, type FindingSeverity, type InternalAuditDetail } from '../api.ts'
import { AttachExisting } from './AttachExisting.tsx'
import { LinkedRecords } from './LinkedRecords.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  auditId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

const STATUS_ACTIONS: Array<{ to: AuditStatus; label: string }> = [
  { to: 'planned', label: 'Planned' },
  { to: 'in_progress', label: 'In progress' },
  { to: 'completed', label: 'Completed' },
]

export function AuditView({ auditId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [audit, setAudit] = useState<InternalAuditDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [busy, setBusy] = useState(false)
  const [severity, setSeverity] = useState<FindingSeverity>('observation')
  const [clause, setClause] = useState('')
  const [description, setDescription] = useState('')
  const [evidence, setEvidence] = useState('')
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<InternalAuditDetail | null>(null)
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .getAudit(auditId)
      .then((payload) => {
        if (cancelled) return
        setAudit(payload)
        latest.current = payload
        onTitleChangeRef.current(payload.number)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load audit')
      })
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [auditId])

  function queueSave(next: InternalAuditDetail) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      if (!current) return
      void api
        .saveAudit(current.id, {
          title: current.title,
          number: current.number,
          scope: current.scope,
          plannedDate: current.plannedDate ?? '',
          auditor: current.auditor,
          findings: current.findings,
        })
        .then((saved) => {
          setSaveState('saved')
          onTitleChangeRef.current(saved.number)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<InternalAuditDetail>) {
    setAudit((current) => {
      if (!current) return current
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function changeStatus(status: AuditStatus) {
    if (!audit) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.setAuditStatus(audit.id, status)
      setAudit(updated)
      latest.current = updated
      onTitleChangeRef.current(updated.number)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed')
    } finally {
      setBusy(false)
    }
  }

  async function spawnFinding(type: 'ncr' | 'capa') {
    if (!audit) return
    setBusy(true)
    setError(null)
    try {
      const record = await api.createAuditLinkedRecord(audit.id, type)
      const refreshed = await api.getAudit(audit.id)
      setAudit(refreshed)
      latest.current = refreshed
      onOpenRecord(record.id, record.title, record.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked record')
    } finally {
      setBusy(false)
    }
  }

  async function addFinding() {
    if (!audit) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.addAuditFinding(audit.id, { severity, clause, description, evidence })
      const refreshed = await api.getAudit(audit.id)
      setAudit(refreshed)
      latest.current = refreshed
      setClause('')
      setDescription('')
      setEvidence('')
      if (result.discrepancy) {
        onOpenLinked({
          id: result.discrepancy.id,
          kind: 'discrepancy',
          title: result.discrepancy.number,
          status: result.discrepancy.status,
          folderId: result.discrepancy.folderId,
          discrepancyId: result.discrepancy.id,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add finding')
    } finally {
      setBusy(false)
    }
  }

  async function createDi(findingId: string) {
    setBusy(true)
    setError(null)
    try {
      const discrepancy = await api.createFindingDiscrepancy(findingId)
      const refreshed = await api.getAudit(auditId)
      setAudit(refreshed)
      latest.current = refreshed
      onOpenLinked({
        id: discrepancy.id,
        kind: 'discrepancy',
        title: discrepancy.number,
        status: discrepancy.status,
        folderId: discrepancy.folderId,
        discrepancyId: discrepancy.id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create DI')
    } finally {
      setBusy(false)
    }
  }

  if (error && !audit) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!audit) {
    return (
      <div className="folder-view">
        <p className="muted">Loading internal audit…</p>
      </div>
    )
  }

  return (
    <div className="doc-view">
      <header className="doc-head">
        <p className="brand-kicker">Internal audit · ISO 9001:2015 9.2</p>
        <div className="dual-toolbar">
          <h1>
            {audit.number}{' '}
            <span className={`pill status-${audit.status}`}>{audit.status.replace('_', ' ')}</span>
          </h1>
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
        </div>
        <p className="muted">Required fields marked *. A MAJOR finding automatically opens a Discrepancy Investigation (8.7 / 10.2).</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          {STATUS_ACTIONS.map((action) => (
            <button
              key={action.to}
              type="button"
              className={audit.status === action.to ? 'primary' : undefined}
              disabled={busy || audit.status === action.to}
              onClick={() => void changeStatus(action.to)}
            >
              {action.label}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => void spawnFinding('ncr')}>
            Create linked NCR
          </button>
          <AttachExisting
            type="ncr"
            sourceKind="audit"
            sourceId={audit.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getAudit(audit.id)
              setAudit(refreshed)
              latest.current = refreshed
            }}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void spawnFinding('capa')}>
            Create linked CAPA
          </button>
          <AttachExisting
            type="capa"
            sourceKind="audit"
            sourceId={audit.id}
            disabled={busy}
            onError={setError}
            onAttached={async () => {
              const refreshed = await api.getAudit(audit.id)
              setAudit(refreshed)
              latest.current = refreshed
            }}
          />
        </div>
        <LinkedRecords items={audit.related} onOpen={onOpenLinked} />
      </header>

      <div className="doc-meta audit-meta">
        <label>
          Title
          <span className="req"> *</span>
          <input value={audit.title} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <label>
          Number
          <span className="req"> *</span>
          <input value={audit.number} onChange={(event) => patch({ number: event.target.value })} />
        </label>
        <label>
          Planned date
          <input
            type="date"
            value={audit.plannedDate ?? ''}
            onChange={(event) => patch({ plannedDate: event.target.value || null })}
          />
        </label>
        <label>
          Auditor
          <span className="req"> *</span>
          <input value={audit.auditor} onChange={(event) => patch({ auditor: event.target.value })} />
        </label>
      </div>

      <label className="doc-body">
        Scope
        <textarea
          rows={3}
          value={audit.scope}
          placeholder="Processes, areas, or clauses in scope for this audit."
          onChange={(event) => patch({ scope: event.target.value })}
        />
      </label>

      <h2>Findings</h2>
      <p className="iso-help">Each finding needs severity, clause, description, and evidence. MAJOR creates a DI immediately.</p>
      <div className="doc-meta audit-meta">
        <label>
          Severity
          <span className="req"> *</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value as FindingSeverity)}>
            <option value="observation">Observation</option>
            <option value="minor">Minor</option>
            <option value="major">Major</option>
          </select>
        </label>
        <label>
          Clause
          <span className="req"> *</span>
          <input
            value={clause}
            placeholder="e.g. 8.5.1"
            onChange={(event) => setClause(event.target.value)}
          />
        </label>
      </div>
      <label className="doc-body">
        Description
        <span className="req"> *</span>
        <textarea
          rows={3}
          value={description}
          placeholder="What was found against the criteria."
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="doc-body">
        Evidence
        <span className="req"> *</span>
        <textarea
          rows={3}
          value={evidence}
          placeholder="Records, interviews, or observations that support the finding."
          onChange={(event) => setEvidence(event.target.value)}
        />
      </label>
      <div className="status-actions">
        <button type="button" className="primary" disabled={busy || !description.trim()} onClick={() => void addFinding()}>
          {busy ? 'Saving…' : 'Add finding'}
        </button>
      </div>

      {(audit.structuredFindings ?? []).length === 0 ? (
        <p className="muted">No structured findings yet.</p>
      ) : (
        <table className="records">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Clause</th>
              <th>Description</th>
              <th>DI</th>
            </tr>
          </thead>
          <tbody>
            {audit.structuredFindings.map((finding) => (
              <tr key={finding.id} className={finding.severity === 'major' ? 'row-overdue' : ''}>
                <td>
                  <span className={`pill status-${finding.severity}`}>{finding.severity}</span>
                </td>
                <td>{finding.clause || '—'}</td>
                <td>
                  {finding.description}
                  {finding.evidence ? <span className="muted"> · {finding.evidence}</span> : null}
                </td>
                <td>
                  {finding.discrepancyId ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        const linked = audit.related.find(
                          (item) => item.kind === 'discrepancy' && item.id === finding.discrepancyId,
                        )
                        onOpenLinked(
                          linked ?? {
                            id: finding.discrepancyId!,
                            kind: 'discrepancy',
                            title: 'DI',
                            status: 'open',
                            discrepancyId: finding.discrepancyId!,
                          },
                        )
                      }}
                    >
                      Open DI
                    </button>
                  ) : finding.severity === 'major' ? (
                    <button type="button" disabled={busy} onClick={() => void createDi(finding.id)}>
                      Create DI
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label className="doc-body">
        Additional notes
        <textarea
          rows={4}
          value={audit.findings}
          placeholder="Optional narrative that is not a structured finding."
          onChange={(event) => patch({ findings: event.target.value })}
        />
      </label>
    </div>
  )
}

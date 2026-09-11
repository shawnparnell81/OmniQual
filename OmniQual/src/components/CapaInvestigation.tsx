import { useEffect, useRef, useState } from 'react'
import { api, type CapaAction, type CapaInvestigation } from '../api.ts'

type Props = {
  recordId: string
  initial: CapaInvestigation
}

export function CapaInvestigationPanel({ recordId, initial }: Props) {
  const [investigation, setInvestigation] = useState<CapaInvestigation>(initial)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latest = useRef<CapaInvestigation>(initial)

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [])

  function queueSave(next: CapaInvestigation) {
    latest.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const current = latest.current
      void api
        .saveInvestigation(recordId, {
          rootCause: current.rootCause,
          rcaMethod: current.rcaMethod,
          effectivenessPlan: current.effectivenessPlan,
          effectivenessResult: current.effectivenessResult,
          verifiedDate: current.verifiedDate,
        })
        .then((saved) => {
          setSaveState('saved')
          setInvestigation(saved)
          latest.current = saved
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function patch(partial: Partial<CapaInvestigation>) {
    setInvestigation((current) => {
      const next = { ...current, ...partial }
      queueSave(next)
      return next
    })
  }

  async function addAction(kind: CapaAction['kind']) {
    setBusy(true)
    setError(null)
    try {
      const saved = await api.addCapaAction(recordId, kind)
      setInvestigation(saved)
      latest.current = saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add action')
    } finally {
      setBusy(false)
    }
  }

  async function patchAction(actionId: string, partial: Partial<CapaAction>) {
    const current = investigation.actions.find((item) => item.id === actionId)
    if (!current) return
    const optimistic = investigation.actions.map((item) =>
      item.id === actionId ? { ...item, ...partial } : item,
    )
    setInvestigation((inv) => ({ ...inv, actions: optimistic }))
    try {
      const saved = await api.saveCapaAction(actionId, {
        kind: partial.kind ?? current.kind,
        description: partial.description ?? current.description,
        owner: partial.owner ?? current.owner,
        dueDate: partial.dueDate === undefined ? current.dueDate : partial.dueDate,
        status: partial.status ?? current.status,
      })
      setInvestigation(saved)
      latest.current = saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update action')
    }
  }

  return (
    <section className="invest-panel" aria-label="CAPA investigation">
      <div className="dual-toolbar">
        <div>
          <p className="brand-kicker">Investigation · ISO 9001:2015 10.2</p>
          <h2>Root cause, actions, and effectiveness</h2>
          <p className="muted">Required: root cause and at least one completed corrective action before close.</p>
        </div>
        <p className="save-state">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
        </p>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <p className="muted">
        Close is blocked until this CAPA has at least one action and an effectiveness result.
      </p>

      <div className="doc-meta audit-meta">
        <label>
          RCA method
          <select
            value={investigation.rcaMethod}
            onChange={(event) =>
              patch({ rcaMethod: event.target.value as CapaInvestigation['rcaMethod'] })
            }
          >
            <option value="5-why">5-why</option>
            <option value="fishbone">Fishbone</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Verified date
          <input
            type="date"
            value={investigation.verifiedDate ?? ''}
            onChange={(event) => patch({ verifiedDate: event.target.value || null })}
          />
        </label>
      </div>

      <label className="doc-body">
        Root cause
        <textarea
          rows={4}
          value={investigation.rootCause}
          placeholder="Document the verified root cause from the chosen method."
          onChange={(event) => patch({ rootCause: event.target.value })}
        />
      </label>

      <div className="dual-toolbar">
        <h2>Corrective and preventive actions</h2>
        <div className="status-actions" style={{ margin: 0 }}>
          <button type="button" disabled={busy} onClick={() => void addAction('corrective')}>
            Add corrective
          </button>
          <button type="button" disabled={busy} onClick={() => void addAction('preventive')}>
            Add preventive
          </button>
        </div>
      </div>

      {investigation.actions.length === 0 ? (
        <p className="muted">No actions yet. Add at least one before closing.</p>
      ) : (
        <table className="records action-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Description</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {investigation.actions.map((action) => (
              <tr key={action.id}>
                <td>
                  <select
                    value={action.kind}
                    onChange={(event) =>
                      void patchAction(action.id, {
                        kind: event.target.value as CapaAction['kind'],
                      })
                    }
                  >
                    <option value="corrective">Corrective</option>
                    <option value="preventive">Preventive</option>
                  </select>
                </td>
                <td>
                  <input
                    value={action.description}
                    placeholder="What will be done"
                    onChange={(event) =>
                      setInvestigation((current) => ({
                        ...current,
                        actions: current.actions.map((item) =>
                          item.id === action.id ? { ...item, description: event.target.value } : item,
                        ),
                      }))
                    }
                    onBlur={(event) => void patchAction(action.id, { description: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={action.owner}
                    placeholder="Owner"
                    onChange={(event) =>
                      setInvestigation((current) => ({
                        ...current,
                        actions: current.actions.map((item) =>
                          item.id === action.id ? { ...item, owner: event.target.value } : item,
                        ),
                      }))
                    }
                    onBlur={(event) => void patchAction(action.id, { owner: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={action.dueDate ?? ''}
                    onChange={(event) =>
                      void patchAction(action.id, { dueDate: event.target.value || null })
                    }
                  />
                </td>
                <td>
                  <select
                    value={action.status}
                    onChange={(event) =>
                      void patchAction(action.id, {
                        status: event.target.value as CapaAction['status'],
                      })
                    }
                  >
                    <option value="open">Open</option>
                    <option value="done">Done</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label className="doc-body">
        Effectiveness check plan
        <textarea
          rows={3}
          value={investigation.effectivenessPlan}
          placeholder="How will you verify the actions worked?"
          onChange={(event) => patch({ effectivenessPlan: event.target.value })}
        />
      </label>
      <label className="doc-body">
        Effectiveness result
        <textarea
          rows={3}
          value={investigation.effectivenessResult}
          placeholder="Record the result of the effectiveness check before closing."
          onChange={(event) => patch({ effectivenessResult: event.target.value })}
        />
      </label>
    </section>
  )
}

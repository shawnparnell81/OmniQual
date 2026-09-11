import { useEffect, useState } from 'react'
import {
  api,
  type CalibrationSummary,
  type ControlledDocumentSummary,
  type DiscrepancySummary,
  type FormRecordSummary,
  type InspectionSummary,
  type InternalAuditSummary,
  type ManagementReviewSummary,
  type NavFolder,
  type SupplierSummary,
  type TrainingAssignmentSummary,
} from '../api.ts'
import { calRowClass, calStatusLabel } from './LinkedRecords.tsx'

type Props = {
  folder: NavFolder
  onOpenRecord: (record: FormRecordSummary, title: string) => void
  onCreated: (recordId: string, title: string) => void
  onOpenDocument: (id: string, title: string, folderId: string) => void
  onOpenAudit: (id: string, title: string, folderId: string) => void
  onOpenTraining: (id: string, title: string) => void
  onOpenCalibration: (id: string, title: string, folderId: string) => void
  onOpenSupplier: (id: string, title: string, folderId: string) => void
  onOpenReview: (id: string, title: string, folderId: string) => void
  onOpenDiscrepancy: (id: string, title: string, folderId: string) => void
  onOpenInspection: (id: string, title: string, folderId: string) => void
}

export function FolderView({
  folder,
  onOpenRecord,
  onCreated,
  onOpenDocument,
  onOpenAudit,
  onOpenTraining,
  onOpenCalibration,
  onOpenSupplier,
  onOpenReview,
  onOpenDiscrepancy,
  onOpenInspection,
}: Props) {
  const isDocumentControl = folder.slug === 'document-control'
  const isAudits = folder.slug === 'audits'
  const isCompetence = folder.slug === 'competence-records'
  const isCalibration = folder.slug === 'calibration'
  const isSupplier = folder.slug === 'supplier-quality'
  const isReview = folder.slug === 'management-review'
  const isDiscrepancy = folder.slug === 'discrepancy'
  const isInspections = folder.slug === 'inspections'
  const isWorkInstructions = folder.slug === 'work-instructions'
  const isSpecial =
    isDocumentControl ||
    isAudits ||
    isCompetence ||
    isCalibration ||
    isSupplier ||
    isReview ||
    isDiscrepancy ||
    isInspections ||
    isWorkInstructions
  const [records, setRecords] = useState<FormRecordSummary[]>([])
  const [documents, setDocuments] = useState<ControlledDocumentSummary[]>([])
  const [audits, setAudits] = useState<InternalAuditSummary[]>([])
  const [assignments, setAssignments] = useState<TrainingAssignmentSummary[]>([])
  const [assets, setAssets] = useState<CalibrationSummary[]>([])
  const [supplierRows, setSupplierRows] = useState<SupplierSummary[]>([])
  const [reviews, setReviews] = useState<ManagementReviewSummary[]>([])
  const [discrepancies, setDiscrepancies] = useState<DiscrepancySummary[]>([])
  const [inspectionRows, setInspectionRows] = useState<InspectionSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    const jobs: Array<Promise<unknown>> = []
    if (!isSpecial) {
      jobs.push(
        api
          .folderRecords(folder.id)
          .then((payload) => {
            if (!cancelled) setRecords(payload.records)
          }),
      )
    }
    if (isDocumentControl) {
      jobs.push(
        api.folderDocuments(folder.id).then((payload) => {
          if (!cancelled) setDocuments(payload.documents)
        }),
      )
    }
    if (isAudits) {
      jobs.push(
        api.folderAudits(folder.id).then((payload) => {
          if (!cancelled) setAudits(payload.audits)
        }),
      )
    }
    if (isCompetence) {
      jobs.push(
        api.folderTraining(folder.id).then((payload) => {
          if (!cancelled) setAssignments(payload.assignments)
        }),
      )
    }
    if (isCalibration) {
      jobs.push(
        api.folderCalibration(folder.id).then((payload) => {
          if (!cancelled) setAssets(payload.assets)
        }),
      )
    }
    if (isSupplier) {
      jobs.push(
        api.folderSuppliers(folder.id).then((payload) => {
          if (!cancelled) setSupplierRows(payload.suppliers)
        }),
      )
    }
    if (isReview) {
      jobs.push(
        api.folderReviews(folder.id).then((payload) => {
          if (!cancelled) setReviews(payload.reviews)
        }),
      )
    }
    if (isDiscrepancy) {
      jobs.push(
        api.folderDiscrepancies(folder.id).then((payload) => {
          if (!cancelled) setDiscrepancies(payload.discrepancies)
        }),
      )
    }
    if (isInspections) {
      jobs.push(
        api.folderInspections(folder.id).then((payload) => {
          if (!cancelled) setInspectionRows(payload.inspections)
        }),
      )
    }
    if (isWorkInstructions) {
      jobs.push(Promise.resolve())
    }
    Promise.all(jobs)
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load folder')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    folder.id,
    isDocumentControl,
    isAudits,
    isCompetence,
    isCalibration,
    isSupplier,
    isReview,
    isDiscrepancy,
    isInspections,
    isWorkInstructions,
    isSpecial,
  ])

  async function createFrom(templateId: string) {
    setBusy(templateId)
    setError(null)
    try {
      const record = await api.createRecord(templateId)
      setRecords((current) => [record, ...current])
      onCreated(record.id, record.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create record')
    } finally {
      setBusy(null)
    }
  }

  async function createDocument() {
    setBusy('document')
    setError(null)
    try {
      const doc = await api.createDocument(folder.id)
      setDocuments((current) => [doc, ...current])
      onOpenDocument(doc.id, `${doc.number} Rev ${doc.revision}`, doc.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create document')
    } finally {
      setBusy(null)
    }
  }

  async function createAudit() {
    setBusy('audit')
    setError(null)
    try {
      const audit = await api.createAudit(folder.id)
      setAudits((current) => [audit, ...current])
      onOpenAudit(audit.id, audit.number, audit.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create audit')
    } finally {
      setBusy(null)
    }
  }

  async function createCalibration() {
    setBusy('calibration')
    setError(null)
    try {
      const asset = await api.createCalibration(folder.id)
      setAssets((current) => [asset, ...current])
      onOpenCalibration(asset.id, asset.number, asset.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create asset')
    } finally {
      setBusy(null)
    }
  }

  async function createSupplier() {
    setBusy('supplier')
    setError(null)
    try {
      const row = await api.createSupplier(folder.id)
      setSupplierRows((current) => [row, ...current])
      onOpenSupplier(row.id, row.number, row.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create supplier')
    } finally {
      setBusy(null)
    }
  }

  async function createReview() {
    setBusy('review')
    setError(null)
    try {
      const row = await api.createReview(folder.id)
      setReviews((current) => [row, ...current])
      onOpenReview(row.id, row.number, row.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create review')
    } finally {
      setBusy(null)
    }
  }

  async function createInspection() {
    setBusy('inspection')
    setError(null)
    try {
      const row = await api.createInspection(folder.id)
      setInspectionRows((current) => [row, ...current])
      onOpenInspection(row.id, row.number, row.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create inspection')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="folder-view">
      <header className="folder-head">
        <p className="brand-kicker">{folder.parentId ? 'Department folder' : 'Department'}</p>
        <h1>{folder.label}</h1>
        <p>
          {isDocumentControl
            ? 'Create, review, and release controlled documents. Releasing a revision obsoletes the previous effective copy of the same number and assigns training.'
            : isAudits
              ? 'Plan and complete internal audits. Record findings here, then open a linked NCR or CAPA in a tab.'
              : isCompetence
                ? 'Training assignments are created when a controlled document is released. Acknowledge the current revision to complete yours.'
                : isCalibration
                  ? 'ISO 9001:2015 7.1.5 — status is computed from interval and last calibration. Overdue, due soon, in tolerance, and out of service are highlighted.'
                  : isSupplier
                    ? 'Approve and evaluate external providers (ISO 9001:2015 8.4). A failed evaluation can open a linked NCR or CAPA.'
                    : isReview
                      ? 'Record ISO 9001:2015 9.3 management reviews. Outputs can open a linked CAPA without leaving the tab.'
                      : isDiscrepancy
                        ? 'Discrepancy investigations (ISO 9001:2015 8.7 / 10.2) open automatically from MAJOR audit findings. Link NCR and CAPA from the record.'
                        : isInspections
                          ? 'Record production inspections (8.5 / 8.6). A fail can open a linked NCR or Discrepancy Investigation.'
                          : isWorkInstructions
                            ? 'Work instructions are controlled documents. Create and release them in Document Control rather than a second module.'
                : 'Open a form to edit it in the app. The controlled PDF updates live — no download, edit, or re-upload cycle.'}
        </p>
      </header>

      {isDocumentControl ? (
        <section>
          <div className="dual-toolbar">
            <h2>Controlled documents</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'document'}
              onClick={() => void createDocument()}
            >
              {busy === 'document' ? 'Creating…' : 'New document'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading documents…</p>
          ) : documents.length === 0 ? (
            <p className="muted">No controlled documents yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Rev</th>
                  <th>Status</th>
                  <th>Effective</th>
                  <th>Training due</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          onOpenDocument(doc.id, `${doc.number} Rev ${doc.revision}`, doc.folderId)
                        }
                      >
                        {doc.number}
                      </button>
                    </td>
                    <td>{doc.title}</td>
                    <td>{doc.revision}</td>
                    <td>
                      <span className={`pill status-${doc.status}`}>{doc.status.replace('_', ' ')}</span>
                    </td>
                    <td>{doc.effectiveDate ?? '—'}</td>
                    <td>{doc.training?.pending ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isAudits ? (
        <section>
          <div className="dual-toolbar">
            <h2>Internal audits</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'audit'}
              onClick={() => void createAudit()}
            >
              {busy === 'audit' ? 'Creating…' : 'New audit'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading audits…</p>
          ) : audits.length === 0 ? (
            <p className="muted">No internal audits yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Auditor</th>
                  <th>Planned</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenAudit(audit.id, audit.number, audit.folderId)}
                      >
                        {audit.number}
                      </button>
                    </td>
                    <td>{audit.title}</td>
                    <td>{audit.auditor || '—'}</td>
                    <td>{audit.plannedDate ?? '—'}</td>
                    <td>
                      <span className={`pill status-${audit.status}`}>{audit.status.replace('_', ' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isCompetence ? (
        <section>
          <h2>Training assignments</h2>
          {loading ? (
            <p className="muted">Loading training…</p>
          ) : assignments.length === 0 ? (
            <p className="muted">No training assignments yet. Release a controlled document to assign the current revision.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Rev</th>
                  <th>Assignee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() =>
                          onOpenTraining(item.id, `${item.documentNumber} Rev ${item.revision}`)
                        }
                      >
                        {item.documentNumber}
                      </button>
                    </td>
                    <td>{item.revision}</td>
                    <td>{item.userName}</td>
                    <td>
                      <span className={`pill status-${item.status}`}>{item.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isCalibration ? (
        <section>
          <div className="dual-toolbar">
            <h2>Measuring equipment</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'calibration'}
              onClick={() => void createCalibration()}
            >
              {busy === 'calibration' ? 'Creating…' : 'New asset'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading calibration assets…</p>
          ) : assets.length === 0 ? (
            <p className="muted">No calibration assets yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Interval</th>
                  <th>Next due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className={calRowClass(asset.status)}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenCalibration(asset.id, asset.number, asset.folderId)}
                      >
                        {asset.number}
                      </button>
                    </td>
                    <td>{asset.name}</td>
                    <td>{asset.location || '—'}</td>
                    <td>every {asset.intervalDays} days</td>
                    <td>{asset.nextDue ?? '—'}</td>
                    <td>
                      <span className={`pill status-${asset.status}`}>{calStatusLabel(asset.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isSupplier ? (
        <section>
          <div className="dual-toolbar">
            <h2>Suppliers</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'supplier'}
              onClick={() => void createSupplier()}
            >
              {busy === 'supplier' ? 'Creating…' : 'New supplier'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading suppliers…</p>
          ) : supplierRows.length === 0 ? (
            <p className="muted">No suppliers yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Name</th>
                  <th>Last evaluation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {supplierRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenSupplier(row.id, row.number, row.folderId)}
                      >
                        {row.number}
                      </button>
                    </td>
                    <td>{row.name}</td>
                    <td>{row.lastEvaluationDate ?? '—'}</td>
                    <td>
                      <span className={`pill status-${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isReview ? (
        <section>
          <div className="dual-toolbar">
            <h2>Management reviews</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'review'}
              onClick={() => void createReview()}
            >
              {busy === 'review' ? 'Creating…' : 'New review'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading reviews…</p>
          ) : reviews.length === 0 ? (
            <p className="muted">No management reviews yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Meeting date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenReview(row.id, row.number, row.folderId)}
                      >
                        {row.number}
                      </button>
                    </td>
                    <td>{row.meetingDate ?? '—'}</td>
                    <td>
                      <span className={`pill status-${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isDiscrepancy ? (
        <section>
          <div className="dual-toolbar">
            <h2>Discrepancy investigations</h2>
          </div>
          <p className="iso-help">New DIs are created from MAJOR internal-audit findings (or a failed inspection). Open a record to link NCR and CAPA.</p>
          {loading ? (
            <p className="muted">Loading discrepancy investigations…</p>
          ) : discrepancies.length === 0 ? (
            <p className="muted">No discrepancy investigations yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenDiscrepancy(row.id, row.number, row.folderId)}
                      >
                        {row.number}
                      </button>
                    </td>
                    <td>
                      <span className={`pill status-${row.status}`}>{row.status}</span>
                    </td>
                    <td>{new Date(row.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isInspections ? (
        <section>
          <div className="dual-toolbar">
            <h2>Inspections</h2>
            <button
              type="button"
              className="primary"
              disabled={busy === 'inspection'}
              onClick={() => void createInspection()}
            >
              {busy === 'inspection' ? 'Creating…' : 'New inspection'}
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading inspections…</p>
          ) : inspectionRows.length === 0 ? (
            <p className="muted">No inspections yet.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Result</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {inspectionRows.map((row) => (
                  <tr key={row.id} className={row.result === 'fail' ? 'row-overdue' : row.result === 'pass' ? 'row-current' : ''}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenInspection(row.id, row.number, row.folderId)}
                      >
                        {row.number}
                      </button>
                    </td>
                    <td>{row.title}</td>
                    <td>
                      <span className={`pill status-${row.result}`}>{row.result}</span>
                    </td>
                    <td>
                      <span className={`pill status-${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : isWorkInstructions ? (
        <section className="empty-panel">
          <h2>Use Document Control</h2>
          <p>
            Work instructions are controlled documents under ISO 9001:2015 7.5. Open Quality → Document Control to
            draft, review, and release them. This folder stays in the tree so Production navigation matches the QMS.
          </p>
        </section>
      ) : folder.templates.length > 0 ? (
        <section>
          <h2>Form templates</h2>
          <div className="card-grid">
            {folder.templates.map((template) => (
              <article key={template.id} className="card">
                <p className="form-code">{template.formCode}</p>
                <h3>{template.title}</h3>
                <p>{template.description}</p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy === template.id}
                  onClick={() => createFrom(template.id)}
                >
                  {busy === template.id ? 'Creating…' : 'New record'}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="empty-panel">
          <h2>No forms in this folder yet</h2>
          <p>
            This department is reserved for later ISO 9001 modules (audits, training matrix, change
            control). Navigation is live so the tree matches a real QMS.
          </p>
        </section>
      )}

      {isSpecial ? null : (
        <section>
          <h2>Records</h2>
          {error ? <p className="form-error">{error}</p> : null}
          {loading ? (
            <p className="muted">Loading records…</p>
          ) : records.length === 0 ? (
            <p className="muted">No records in this folder.</p>
          ) : (
            <table className="records">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenRecord(record, record.title)}
                      >
                        {record.title}
                      </button>
                    </td>
                    <td>
                      <span className={`pill status-${record.status}`}>{record.status}</span>
                    </td>
                    <td>{new Date(record.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {isSpecial && error ? <p className="form-error">{error}</p> : null}
    </div>
  )
}

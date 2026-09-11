import { useEffect, useRef, useState } from 'react'
import { api, type FormDataMap, type FormRecordDetail } from '../api.ts'
import { AttachExisting } from './AttachExisting.tsx'
import { CapaInvestigationPanel } from './CapaInvestigation.tsx'
import { FormFields } from './FormFields.tsx'
import { LinkedRecords } from './LinkedRecords.tsx'
import { PdfPreview } from './PdfPreview.tsx'
import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  recordId: string
  onTitleChange: (title: string) => void
  onOpenRecord: (recordId: string, title: string, folderId: string) => void
  onOpenLinked: (item: LinkedItem) => void
}

export function DualFormView({ recordId, onTitleChange, onOpenRecord, onOpenLinked }: Props) {
  const [record, setRecord] = useState<FormRecordDetail | null>(null)
  const [data, setData] = useState<FormDataMap>({})
  const [templateBytes, setTemplateBytes] = useState<ArrayBuffer | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<number | null>(null)
  const latestData = useRef<FormDataMap>({})
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    let cancelled = false
    setError(null)
    setTemplateBytes(null)
    setRecord(null)

    async function load() {
      try {
        const loaded = await api.getRecord(recordId)
        if (cancelled) return
        setRecord(loaded)
        setData(loaded.data)
        latestData.current = loaded.data
        onTitleChangeRef.current(loaded.title)
        const pdfResponse = await fetch(api.templatePdfUrl(loaded.templateId), {
          credentials: 'include',
        })
        if (!pdfResponse.ok) throw new Error('Could not load the controlled PDF template.')
        const bytes = await pdfResponse.arrayBuffer()
        if (!cancelled) setTemplateBytes(bytes)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load form')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [recordId])

  function queueSave(next: FormDataMap) {
    latestData.current = next
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void api
        .saveRecord(recordId, { data: latestData.current })
        .then((saved) => {
          setSaveState('saved')
          setRecord(saved)
          onTitleChangeRef.current(saved.title)
        })
        .catch(() => setSaveState('error'))
    }, 450)
  }

  function onChange(id: string, value: string | boolean) {
    setData((current) => {
      const next = { ...current, [id]: value }
      queueSave(next)
      return next
    })
  }

  async function setStatus(status: string) {
    setBusy(true)
    setError(null)
    try {
      const saved = await api.saveRecord(recordId, { status, data: latestData.current })
      setRecord(saved)
      onTitleChangeRef.current(saved.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status')
    } finally {
      setBusy(false)
    }
  }

  async function spawnCapa() {
    setBusy(true)
    setError(null)
    try {
      const capa = await api.createLinkedCapa(recordId)
      const refreshed = await api.getRecord(recordId)
      setRecord(refreshed)
      onOpenRecord(capa.id, capa.title, capa.folderId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create linked CAPA')
    } finally {
      setBusy(false)
    }
  }

  async function downloadExport() {
    const response = await fetch(api.recordPdfUrl(recordId, true), { credentials: 'include' })
    if (!response.ok) return
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const title =
      typeof latestData.current.ncrNumber === 'string'
        ? latestData.current.ncrNumber
        : typeof latestData.current.capaNumber === 'string'
          ? latestData.current.capaNumber
          : recordId
    link.href = url
    link.download = `${title}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (error && !record) {
    return (
      <div className="folder-view">
        <p className="form-error">{error}</p>
      </div>
    )
  }

  if (!record || !templateBytes) {
    return (
      <div className="folder-view">
        <p className="muted">Loading form and PDF template…</p>
      </div>
    )
  }

  const editor = (
    <div className="dual">
      <section className="dual-form">
        <div className="dual-toolbar">
          <p className="save-state">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </p>
          <button type="button" onClick={() => void downloadExport()}>
            Download PDF
          </button>
        </div>
        <p className="muted">
          Editing {record.templateTitle}. {record.schema.isoClause ? `${record.schema.isoClause}. ` : ''}
          Required fields marked *. Changes write to this tenant only.{' '}
          <span className={`pill status-${record.status}`}>{record.status}</span>
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="status-actions">
          {(['draft', 'open', 'closed'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={record.status === status ? 'primary' : undefined}
              disabled={busy || record.status === status}
              onClick={() => void setStatus(status)}
            >
              {status}
            </button>
          ))}
          {record.templateSlug === 'ncr' ? (
            <>
              <button type="button" className="primary" disabled={busy} onClick={() => void spawnCapa()}>
                Create linked CAPA
              </button>
              <AttachExisting
                type="capa"
                sourceKind="ncr"
                sourceId={record.id}
                disabled={busy}
                onError={setError}
                onAttached={async () => {
                  const refreshed = await api.getRecord(record.id)
                  setRecord(refreshed)
                  onTitleChangeRef.current(refreshed.title)
                }}
              />
            </>
          ) : null}
        </div>
        <LinkedRecords items={record.related} onOpen={onOpenLinked} />
        <FormFields schema={record.schema} data={data} onChange={onChange} />
      </section>
      <section className="dual-pdf" aria-label="Live PDF preview">
        <PdfPreview templateBytes={templateBytes} data={data} />
      </section>
    </div>
  )

  if (record.templateSlug !== 'capa' || !record.investigation) return editor

  return (
    <div className="capa-workspace">
      {editor}
      <CapaInvestigationPanel key={record.id} recordId={record.id} initial={record.investigation} />
    </div>
  )
}

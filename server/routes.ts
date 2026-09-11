import { randomUUID } from 'node:crypto'
import { and, eq, inArray, or } from 'drizzle-orm'
import { Router } from 'express'
import type {
  AuditStatus,
  CapaInvestigation,
  ControlledDocumentDetail,
  DocumentStatus,
  FormDataMap,
  NavFolder,
  RecordLink,
  TemplateSummary,
  TrainingCounts,
} from '../shared/types.ts'
import {
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
  requireAuth,
  type AuthedRequest,
} from './auth.ts'
import { getDb, getDriverLabel } from './db/client.ts'
import {
  auditEvents,
  auditRecordLinks,
  capaActions,
  capaInvestigations,
  controlledDocuments,
  folders,
  formRecords,
  formTemplates,
  internalAudits,
  recordLinks,
  trainingAssignments,
  users,
  type ControlledDocument,
  type FormRecord,
} from './db/schema.ts'
import { fillPdfBytes, pdfFromBase64 } from './pdf/templates.ts'
import { registerIsoRoutes } from './isoRoutes.ts'
import { registerDiRoutes } from './diRoutes.ts'
import {
  assignTrainingOnRelease,
  ATTACH_SOURCE_KINDS,
  attachExistingRecord,
  capaCanClose,
  collectRelated,
  createFormFromTemplate,
  emptyTraining,
  loadCapaInvestigation,
  searchAttachableRecords,
  toAuditDetail,
  toAuditSummary,
  toTrainingSummary,
  trainingCountsByDocumentIds,
  trainingCountsFor,
  type AttachSourceKind,
} from './qms.ts'

export const api = Router()

const DOCUMENT_STATUSES: DocumentStatus[] = ['draft', 'in_review', 'effective', 'obsolete']
const RECORD_STATUSES = ['draft', 'open', 'closed'] as const
const AUDIT_STATUSES: AuditStatus[] = ['planned', 'in_progress', 'completed']
const RCA_METHODS = ['5-why', 'fishbone', 'other'] as const
const CAPA_ACTION_KINDS = ['corrective', 'preventive'] as const
const CAPA_ACTION_STATUSES = ['open', 'done'] as const

function orgIdOf(req: AuthedRequest) {
  return req.user!.organization.id
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function bumpRevision(revision: string) {
  const numeric = Number.parseInt(revision, 10)
  if (Number.isFinite(numeric)) return String(numeric + 1).padStart(Math.max(2, revision.length), '0')
  const last = revision.at(-1)
  if (last && /[A-Ya-y]/.test(last)) return revision.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1)
  return `${revision}.1`
}

function toDocument(row: ControlledDocument, training: TrainingCounts = emptyTraining()): ControlledDocumentDetail {
  return {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    number: row.number,
    revision: row.revision,
    status: row.status as DocumentStatus,
    effectiveDate: row.effectiveDate ? String(row.effectiveDate).slice(0, 10) : null,
    body: row.body,
    trainingRoles: row.trainingRoles ?? '',
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    training,
  }
}

async function toDocumentDetail(row: ControlledDocument, orgId: string) {
  return toDocument(row, await trainingCountsFor(orgId, row.id))
}

async function writeAudit(
  orgId: string,
  userId: string | undefined,
  entityType: string,
  entityId: string,
  action: string,
  beforeJson?: unknown,
  afterJson?: unknown,
) {
  const db = await getDb()
  await db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId: orgId,
    userId: userId ?? null,
    entityType,
    entityId,
    action,
    beforeJson: beforeJson ?? null,
    afterJson: afterJson ?? null,
  })
}

async function loadRecordLinks(orgId: string, recordId: string): Promise<RecordLink[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.organizationId, orgId),
        or(eq(recordLinks.fromRecordId, recordId), eq(recordLinks.toRecordId, recordId)),
      ),
    )

  const otherIds = rows.map((row) => (row.fromRecordId === recordId ? row.toRecordId : row.fromRecordId))
  const related = otherIds.length
    ? await db
        .select()
        .from(formRecords)
        .where(and(eq(formRecords.organizationId, orgId), inArray(formRecords.id, otherIds)))
    : []
  const byId = new Map(related.map((row) => [row.id, row]))

  return rows.flatMap((row) => {
    const direction = row.fromRecordId === recordId ? 'from' : 'to'
    const otherId = direction === 'from' ? row.toRecordId : row.fromRecordId
    const other = byId.get(otherId)
    if (!other) return []
    return [
      {
        id: row.id,
        recordId: other.id,
        folderId: other.folderId,
        title: other.title,
        status: other.status,
        kind: row.kind,
        direction,
      } satisfies RecordLink,
    ]
  })
}

async function toRecordDetail(record: FormRecord, orgId: string) {
  const db = await getDb()
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, orgId)))
  if (!template) return null
  const links = await loadRecordLinks(orgId, record.id)
  const investigation = template.slug === 'capa' ? await loadCapaInvestigation(orgId, record.id) : null
  return {
    id: record.id,
    templateId: record.templateId,
    folderId: record.folderId,
    title: record.title,
    status: record.status,
    data: record.data,
    schema: template.schemaJson,
    templateTitle: template.title,
    templateSlug: template.slug,
    links,
    related: await collectRelated(orgId, 'form', record.id),
    investigation,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

api.get('/health', (_req, res) => {
  res.json({ ok: true, driver: getDriverLabel() })
})

api.post('/auth/login', loginHandler)
api.post('/auth/register', registerHandler)
api.post('/auth/logout', logoutHandler)
api.get('/auth/me', requireAuth, meHandler)

api.get('/nav', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const allFolders = await db.select().from(folders).where(eq(folders.organizationId, orgId))
  const templates = await db
    .select()
    .from(formTemplates)
    .where(eq(formTemplates.organizationId, orgId))

  const templateByFolder = new Map<string, TemplateSummary[]>()
  for (const template of templates) {
    const summary: TemplateSummary = {
      id: template.id,
      folderId: template.folderId,
      title: template.title,
      description: template.description,
      formCode: template.schemaJson.formCode,
      version: template.version,
      status: template.status as TemplateSummary['status'],
    }
    const list = templateByFolder.get(template.folderId) ?? []
    list.push(summary)
    templateByFolder.set(template.folderId, list)
  }

  const byParent = new Map<string | null, typeof allFolders>()
  for (const folder of allFolders) {
    const key = folder.parentId
    const list = byParent.get(key) ?? []
    list.push(folder)
    byParent.set(key, list)
  }

  function toNode(folder: (typeof allFolders)[number]): NavFolder {
    const children = (byParent.get(folder.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toNode)
    return {
      id: folder.id,
      slug: folder.slug,
      label: folder.label,
      parentId: folder.parentId,
      sortOrder: folder.sortOrder,
      children,
      templates: templateByFolder.get(folder.id) ?? [],
    }
  }

  const tree = (byParent.get(null) ?? [])
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toNode)

  res.json({ departments: tree, organization: req.user!.organization })
})

api.get('/folders/:id/records', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, req.params.id as string), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }

  const records = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.folderId, folder.id), eq(formRecords.organizationId, orgId)))

  res.json({
    records: records
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((record) => ({
        id: record.id,
        templateId: record.templateId,
        folderId: record.folderId,
        title: record.title,
        status: record.status,
        updatedAt: record.updatedAt.toISOString(),
        createdAt: record.createdAt.toISOString(),
      })),
  })
})

api.get('/folders/:id/documents', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, req.params.id as string), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }

  const docs = await db
    .select()
    .from(controlledDocuments)
    .where(and(eq(controlledDocuments.folderId, folder.id), eq(controlledDocuments.organizationId, orgId)))
  const counts = await trainingCountsByDocumentIds(
    orgId,
    docs.map((doc) => doc.id),
  )

  res.json({
    documents: docs
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((doc) => {
        const detail = toDocument(doc, counts.get(doc.id) ?? emptyTraining())
        return {
          id: detail.id,
          folderId: detail.folderId,
          title: detail.title,
          number: detail.number,
          revision: detail.revision,
          status: detail.status,
          effectiveDate: detail.effectiveDate,
          updatedAt: detail.updatedAt,
          createdAt: detail.createdAt,
          training: detail.training,
        }
      }),
  })
})

api.get('/templates/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(
      and(eq(formTemplates.id, req.params.id as string), eq(formTemplates.organizationId, orgIdOf(req))),
    )
  if (!template) {
    res.status(404).json({ error: 'Template not found.' })
    return
  }
  res.json({
    id: template.id,
    folderId: template.folderId,
    title: template.title,
    description: template.description,
    schema: template.schemaJson,
    version: template.version,
    status: template.status,
  })
})

api.get('/templates/:id/pdf', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(
      and(eq(formTemplates.id, req.params.id as string), eq(formTemplates.organizationId, orgIdOf(req))),
    )
  if (!template) {
    res.status(404).json({ error: 'Template not found.' })
    return
  }
  const bytes = pdfFromBase64(template.pdfBytes)
  res.setHeader('Content-Type', 'application/pdf')
  res.send(Buffer.from(bytes))
})

api.post('/records', requireAuth, async (req: AuthedRequest, res) => {
  const templateId = String(req.body?.templateId ?? '')
  if (!templateId) {
    res.status(400).json({ error: 'templateId is required.' })
    return
  }

  const db = await getDb()
  const orgId = orgIdOf(req)
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, templateId), eq(formTemplates.organizationId, orgId)))
  if (!template) {
    res.status(404).json({ error: 'Template not found.' })
    return
  }

  const seed = (req.body?.data as FormDataMap | undefined) ?? {}
  const existing = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.templateId, templateId), eq(formRecords.organizationId, orgId)))
  const seq = String(existing.length + 1).padStart(4, '0')
  const prefix = template.schemaJson.formCode.replace(/^QMS-/, '').replace(/-\d+$/, '')
  const number = `${prefix}-${seq}`
  const numberField = template.schemaJson.fields.find((field) => /number/i.test(field.id))
  const dateField = template.schemaJson.fields.find((field) => field.type === 'date')
  const data: FormDataMap = { ...seed }
  if (numberField && !data[numberField.id]) data[numberField.id] = number
  if (dateField && !data[dateField.id]) data[dateField.id] = todayStamp()

  const id = randomUUID()
  const now = new Date()
  await db.insert(formRecords).values({
    id,
    organizationId: orgId,
    templateId: template.id,
    folderId: template.folderId,
    title: number,
    data,
    status: 'draft',
    createdBy: req.user?.id,
    createdAt: now,
    updatedAt: now,
  })

  await writeAudit(orgId, req.user?.id, 'form_record', id, 'create', undefined, data)
  const [created] = await db.select().from(formRecords).where(eq(formRecords.id, id))
  res.status(201).json(await toRecordDetail(created, orgId))
})

api.get('/records/search', requireAuth, async (req: AuthedRequest, res) => {
  const type = String(req.query.type ?? '')
  if (type !== 'ncr' && type !== 'capa') {
    res.status(400).json({ error: 'type must be ncr or capa.' })
    return
  }
  const sourceKind = String(req.query.sourceKind ?? '')
  const sourceId = String(req.query.sourceId ?? '')
  if (!ATTACH_SOURCE_KINDS.includes(sourceKind as AttachSourceKind) || !sourceId) {
    res.status(400).json({ error: 'sourceKind and sourceId are required.' })
    return
  }
  const q = typeof req.query.q === 'string' ? req.query.q : ''
  const records = await searchAttachableRecords({
    orgId: orgIdOf(req),
    type,
    q,
    sourceKind: sourceKind as AttachSourceKind,
    sourceId,
  })
  res.json({ records })
})

api.post('/records/attach', requireAuth, async (req: AuthedRequest, res) => {
  const type = String(req.body?.type ?? '')
  const recordId = String(req.body?.recordId ?? '')
  const sourceKind = String(req.body?.sourceKind ?? '')
  const sourceId = String(req.body?.sourceId ?? '')
  if (type !== 'ncr' && type !== 'capa') {
    res.status(400).json({ error: 'type must be ncr or capa.' })
    return
  }
  if (!recordId) {
    res.status(400).json({ error: 'recordId is required.' })
    return
  }
  if (!ATTACH_SOURCE_KINDS.includes(sourceKind as AttachSourceKind) || !sourceId) {
    res.status(400).json({ error: 'sourceKind and sourceId are required.' })
    return
  }
  const result = await attachExistingRecord({
    orgId: orgIdOf(req),
    type,
    recordId,
    sourceKind: sourceKind as AttachSourceKind,
    sourceId,
  })
  if (!result.ok) {
    res.status(result.status).json({ error: result.error })
    return
  }
  await writeAudit(orgIdOf(req), req.user?.id, 'form_record', result.record.id, 'link', undefined, {
    sourceKind,
    sourceId,
    type,
  })
  res.json({
    id: result.record.id,
    folderId: result.record.folderId,
    title: result.record.title,
    status: result.record.status,
    templateId: result.record.templateId,
  })
})

api.get('/records/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!record) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }
  const detail = await toRecordDetail(record, orgId)
  if (!detail) {
    res.status(404).json({ error: 'Template missing for record.' })
    return
  }
  res.json(detail)
})

api.patch('/records/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!record) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }

  const nextData = {
    ...record.data,
    ...(req.body?.data as FormDataMap | undefined),
  }
  let nextStatus = record.status
  if (typeof req.body?.status === 'string') {
    if (!RECORD_STATUSES.includes(req.body.status as (typeof RECORD_STATUSES)[number])) {
      res.status(400).json({ error: 'Status must be draft, open, or closed.' })
      return
    }
    nextStatus = req.body.status
  }

  if (nextStatus === 'closed' && nextStatus !== record.status) {
    const [template] = await db
      .select()
      .from(formTemplates)
      .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, orgId)))
    if (template?.slug === 'capa' && !(await capaCanClose(orgId, record.id))) {
      res.status(409).json({
        error: 'Close a CAPA only after at least one action and an effectiveness result.',
      })
      return
    }
  }

  const titleFromNumber =
    typeof nextData.ncrNumber === 'string'
      ? nextData.ncrNumber
      : typeof nextData.capaNumber === 'string'
        ? nextData.capaNumber
        : typeof nextData.courseTitle === 'string' && nextData.courseTitle
          ? String(nextData.courseTitle)
          : record.title

  const now = new Date()
  await db
    .update(formRecords)
    .set({ data: nextData, title: titleFromNumber, status: nextStatus, updatedAt: now })
    .where(and(eq(formRecords.id, record.id), eq(formRecords.organizationId, orgId)))

  await writeAudit(
    orgId,
    req.user?.id,
    'form_record',
    record.id,
    nextStatus === record.status ? 'update' : 'status',
    { data: record.data, status: record.status },
    { data: nextData, status: nextStatus },
  )

  const [updated] = await db.select().from(formRecords).where(eq(formRecords.id, record.id))
  res.json(await toRecordDetail(updated, orgId))
})

api.post('/records/:id/linked-capa', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [source] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!source) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }

  const [sourceTemplate] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, source.templateId), eq(formTemplates.organizationId, orgId)))
  if (!sourceTemplate || sourceTemplate.slug !== 'ncr') {
    res.status(400).json({ error: 'A linked CAPA can only be created from an NCR.' })
    return
  }

  const [capaTemplate] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.slug, 'capa'), eq(formTemplates.organizationId, orgId)))
  if (!capaTemplate) {
    res.status(404).json({ error: 'CAPA template not found for this tenant.' })
    return
  }

  const existingLinks = await db
    .select()
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.organizationId, orgId),
        eq(recordLinks.fromRecordId, source.id),
        eq(recordLinks.kind, 'ncr_capa'),
      ),
    )
  if (existingLinks.length > 0) {
    const [existing] = await db
      .select()
      .from(formRecords)
      .where(and(eq(formRecords.id, existingLinks[0].toRecordId), eq(formRecords.organizationId, orgId)))
    if (existing) {
      res.json(await toRecordDetail(existing, orgId))
      return
    }
  }

  const existingCapas = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.templateId, capaTemplate.id), eq(formRecords.organizationId, orgId)))
  const seq = String(existingCapas.length + 1).padStart(4, '0')
  const number = `CAPA-${seq}`
  const data: FormDataMap = {
    capaNumber: number,
    dateOpened: todayStamp(),
    initiatedBy: String(source.data.reportedBy ?? ''),
    source: 'NCR',
    problemStatement: String(source.data.description ?? source.data.ncrNumber ?? source.title),
    containment: String(source.data.immediateAction ?? ''),
    owner: String(source.data.owner ?? ''),
  }

  const id = randomUUID()
  const now = new Date()
  await db.insert(formRecords).values({
    id,
    organizationId: orgId,
    templateId: capaTemplate.id,
    folderId: capaTemplate.folderId,
    title: number,
    data,
    status: 'open',
    createdBy: req.user?.id,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(recordLinks).values({
    id: randomUUID(),
    organizationId: orgId,
    fromRecordId: source.id,
    toRecordId: id,
    kind: 'ncr_capa',
  })

  if (source.status === 'draft') {
    await db
      .update(formRecords)
      .set({ status: 'open', updatedAt: now })
      .where(and(eq(formRecords.id, source.id), eq(formRecords.organizationId, orgId)))
  }

  await writeAudit(orgId, req.user?.id, 'form_record', id, 'create', undefined, {
    fromNcr: source.id,
    data,
  })

  const [created] = await db.select().from(formRecords).where(eq(formRecords.id, id))
  res.status(201).json(await toRecordDetail(created, orgId))
})

api.get('/records/:id/pdf', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!record) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, orgId)))
  if (!template) {
    res.status(404).json({ error: 'Template missing for record.' })
    return
  }

  const flatten = req.query.flatten === '1' || req.query.flatten === 'true'
  const download = req.query.download === '1' || req.query.download === 'true'
  const filled = await fillPdfBytes(pdfFromBase64(template.pdfBytes), record.data, flatten)
  res.setHeader('Content-Type', 'application/pdf')
  if (download) {
    const safe = record.title.replace(/[^\w.-]+/g, '_')
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`)
  }
  res.send(Buffer.from(filled))
})

api.post('/documents', requireAuth, async (req: AuthedRequest, res) => {
  const folderId = String(req.body?.folderId ?? '')
  const title = String(req.body?.title ?? '').trim() || 'Untitled procedure'
  if (!folderId) {
    res.status(400).json({ error: 'folderId is required.' })
    return
  }

  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }

  const existing = await db
    .select()
    .from(controlledDocuments)
    .where(eq(controlledDocuments.organizationId, orgId))
  const seq = String(existing.length + 1).padStart(4, '0')
  const number = String(req.body?.number ?? '').trim() || `SOP-${seq}`
  const revision = String(req.body?.revision ?? '').trim() || '01'
  const id = randomUUID()
  const now = new Date()

  await db.insert(controlledDocuments).values({
    id,
    organizationId: orgId,
    folderId: folder.id,
    title,
    number,
    revision,
    status: 'draft',
    effectiveDate: null,
    body: String(req.body?.body ?? ''),
    createdBy: req.user?.id,
    createdAt: now,
    updatedAt: now,
  })

  const [created] = await db.select().from(controlledDocuments).where(eq(controlledDocuments.id, id))
  const createdDetail = await toDocumentDetail(created, orgId)
  await writeAudit(orgId, req.user?.id, 'controlled_document', id, 'create', undefined, createdDetail)
  res.status(201).json(createdDetail)
})

api.get('/documents/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const [doc] = await db
    .select()
    .from(controlledDocuments)
    .where(
      and(eq(controlledDocuments.id, req.params.id as string), eq(controlledDocuments.organizationId, orgIdOf(req))),
    )
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }
  res.json(await toDocumentDetail(doc, orgIdOf(req)))
})

api.patch('/documents/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [doc] = await db
    .select()
    .from(controlledDocuments)
    .where(and(eq(controlledDocuments.id, req.params.id as string), eq(controlledDocuments.organizationId, orgId)))
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }
  if (doc.status === 'effective' || doc.status === 'obsolete') {
    res.status(409).json({ error: 'Effective and obsolete documents cannot be edited. Create a new revision.' })
    return
  }

  const next = {
    title: typeof req.body?.title === 'string' ? req.body.title.trim() || doc.title : doc.title,
    number: typeof req.body?.number === 'string' ? req.body.number.trim() || doc.number : doc.number,
    revision: typeof req.body?.revision === 'string' ? req.body.revision.trim() || doc.revision : doc.revision,
    body: typeof req.body?.body === 'string' ? req.body.body : doc.body,
    trainingRoles:
      typeof req.body?.trainingRoles === 'string' ? req.body.trainingRoles : doc.trainingRoles,
  }

  await db
    .update(controlledDocuments)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(controlledDocuments.id, doc.id), eq(controlledDocuments.organizationId, orgId)))

  const [updated] = await db.select().from(controlledDocuments).where(eq(controlledDocuments.id, doc.id))
  const before = await toDocumentDetail(doc, orgId)
  const after = await toDocumentDetail(updated, orgId)
  await writeAudit(orgId, req.user?.id, 'controlled_document', doc.id, 'update', before, after)
  res.json(after)
})

api.post('/documents/:id/status', requireAuth, async (req: AuthedRequest, res) => {
  const nextStatus = String(req.body?.status ?? '') as DocumentStatus
  if (!DOCUMENT_STATUSES.includes(nextStatus)) {
    res.status(400).json({ error: 'Invalid document status.' })
    return
  }

  const db = await getDb()
  const orgId = orgIdOf(req)
  const [doc] = await db
    .select()
    .from(controlledDocuments)
    .where(and(eq(controlledDocuments.id, req.params.id as string), eq(controlledDocuments.organizationId, orgId)))
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }

  const allowed =
    (doc.status === 'draft' && nextStatus === 'in_review') ||
    (doc.status === 'in_review' && (nextStatus === 'draft' || nextStatus === 'effective')) ||
    (doc.status === 'effective' && nextStatus === 'obsolete')
  if (!allowed) {
    res.status(409).json({ error: `Cannot move from ${doc.status} to ${nextStatus}.` })
    return
  }

  const now = new Date()
  if (nextStatus === 'effective') {
    const currentEffective = await db
      .select()
      .from(controlledDocuments)
      .where(
        and(
          eq(controlledDocuments.organizationId, orgId),
          eq(controlledDocuments.number, doc.number),
          eq(controlledDocuments.status, 'effective'),
        ),
      )
    for (const previous of currentEffective) {
      if (previous.id === doc.id) continue
      await db
        .update(controlledDocuments)
        .set({ status: 'obsolete', updatedAt: now })
        .where(and(eq(controlledDocuments.id, previous.id), eq(controlledDocuments.organizationId, orgId)))
      await writeAudit(
        orgId,
        req.user?.id,
        'controlled_document',
        previous.id,
        'status',
        { status: previous.status },
        { status: 'obsolete', supersededBy: doc.id },
      )
    }
  }

  await db
    .update(controlledDocuments)
    .set({
      status: nextStatus,
      effectiveDate: nextStatus === 'effective' ? todayStamp() : doc.effectiveDate,
      updatedAt: now,
    })
    .where(and(eq(controlledDocuments.id, doc.id), eq(controlledDocuments.organizationId, orgId)))

  const [updated] = await db.select().from(controlledDocuments).where(eq(controlledDocuments.id, doc.id))
  let assigned = 0
  if (nextStatus === 'effective') {
    assigned = await assignTrainingOnRelease(orgId, updated)
  }
  await writeAudit(
    orgId,
    req.user?.id,
    'controlled_document',
    doc.id,
    'status',
    { status: doc.status },
    { status: nextStatus, trainingAssigned: assigned || undefined },
  )
  res.json(await toDocumentDetail(updated, orgId))
})

api.post('/documents/:id/revise', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [doc] = await db
    .select()
    .from(controlledDocuments)
    .where(and(eq(controlledDocuments.id, req.params.id as string), eq(controlledDocuments.organizationId, orgId)))
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' })
    return
  }
  if (doc.status !== 'effective' && doc.status !== 'obsolete') {
    res.status(409).json({ error: 'Only released documents can be revised.' })
    return
  }

  const id = randomUUID()
  const now = new Date()
  await db.insert(controlledDocuments).values({
    id,
    organizationId: orgId,
    folderId: doc.folderId,
    title: doc.title,
    number: doc.number,
    revision: bumpRevision(doc.revision),
    status: 'draft',
    effectiveDate: null,
    body: doc.body,
    trainingRoles: doc.trainingRoles,
    createdBy: req.user?.id,
    createdAt: now,
    updatedAt: now,
  })
  const [created] = await db.select().from(controlledDocuments).where(eq(controlledDocuments.id, id))
  const createdDetail = await toDocumentDetail(created, orgId)
  await writeAudit(orgId, req.user?.id, 'controlled_document', id, 'create', undefined, {
    revisedFrom: doc.id,
    ...createdDetail,
  })
  res.status(201).json(createdDetail)
})

api.get('/folders/:id/audits', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, req.params.id as string), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }
  const rows = await db
    .select()
    .from(internalAudits)
    .where(and(eq(internalAudits.folderId, folder.id), eq(internalAudits.organizationId, orgId)))
  res.json({
    audits: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toAuditSummary),
  })
})

api.post('/audits', requireAuth, async (req: AuthedRequest, res) => {
  const folderId = String(req.body?.folderId ?? '')
  if (!folderId) {
    res.status(400).json({ error: 'folderId is required.' })
    return
  }
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }

  const existing = await db.select().from(internalAudits).where(eq(internalAudits.organizationId, orgId))
  const seq = String(existing.length + 1).padStart(4, '0')
  const number = String(req.body?.number ?? '').trim() || `AUD-${seq}`
  const id = randomUUID()
  const now = new Date()
  await db.insert(internalAudits).values({
    id,
    organizationId: orgId,
    folderId: folder.id,
    title: String(req.body?.title ?? '').trim() || 'Internal audit',
    number,
    scope: String(req.body?.scope ?? '').trim(),
    plannedDate: typeof req.body?.plannedDate === 'string' && req.body.plannedDate ? req.body.plannedDate : null,
    auditor: String(req.body?.auditor ?? req.user?.name ?? '').trim(),
    status: 'planned',
    findings: String(req.body?.findings ?? ''),
    createdBy: req.user?.id,
    createdAt: now,
    updatedAt: now,
  })
  const [created] = await db.select().from(internalAudits).where(eq(internalAudits.id, id))
  const detail = await toAuditDetail(created, orgId)
  await writeAudit(orgId, req.user?.id, 'internal_audit', id, 'create', undefined, detail)
  res.status(201).json(detail)
})

api.get('/audits/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [audit] = await db
    .select()
    .from(internalAudits)
    .where(and(eq(internalAudits.id, req.params.id as string), eq(internalAudits.organizationId, orgId)))
  if (!audit) {
    res.status(404).json({ error: 'Audit not found.' })
    return
  }
  res.json(await toAuditDetail(audit, orgId))
})

api.patch('/audits/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [audit] = await db
    .select()
    .from(internalAudits)
    .where(and(eq(internalAudits.id, req.params.id as string), eq(internalAudits.organizationId, orgId)))
  if (!audit) {
    res.status(404).json({ error: 'Audit not found.' })
    return
  }

  const next = {
    title: typeof req.body?.title === 'string' ? req.body.title.trim() || audit.title : audit.title,
    number: typeof req.body?.number === 'string' ? req.body.number.trim() || audit.number : audit.number,
    scope: typeof req.body?.scope === 'string' ? req.body.scope : audit.scope,
    plannedDate:
      typeof req.body?.plannedDate === 'string'
        ? req.body.plannedDate || null
        : audit.plannedDate,
    auditor: typeof req.body?.auditor === 'string' ? req.body.auditor : audit.auditor,
    findings: typeof req.body?.findings === 'string' ? req.body.findings : audit.findings,
  }

  await db
    .update(internalAudits)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(internalAudits.id, audit.id), eq(internalAudits.organizationId, orgId)))
  const [updated] = await db.select().from(internalAudits).where(eq(internalAudits.id, audit.id))
  res.json(await toAuditDetail(updated, orgId))
})

api.post('/audits/:id/status', requireAuth, async (req: AuthedRequest, res) => {
  const nextStatus = String(req.body?.status ?? '') as AuditStatus
  if (!AUDIT_STATUSES.includes(nextStatus)) {
    res.status(400).json({ error: 'Status must be planned, in_progress, or completed.' })
    return
  }
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [audit] = await db
    .select()
    .from(internalAudits)
    .where(and(eq(internalAudits.id, req.params.id as string), eq(internalAudits.organizationId, orgId)))
  if (!audit) {
    res.status(404).json({ error: 'Audit not found.' })
    return
  }
  if (audit.status === nextStatus) {
    res.json(await toAuditDetail(audit, orgId))
    return
  }
  await db
    .update(internalAudits)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(and(eq(internalAudits.id, audit.id), eq(internalAudits.organizationId, orgId)))
  const [updated] = await db.select().from(internalAudits).where(eq(internalAudits.id, audit.id))
  await writeAudit(
    orgId,
    req.user?.id,
    'internal_audit',
    audit.id,
    'status',
    { status: audit.status },
    { status: nextStatus },
  )
  res.json(await toAuditDetail(updated, orgId))
})

api.post('/audits/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
  const type = String(req.body?.type ?? '')
  if (type !== 'ncr' && type !== 'capa') {
    res.status(400).json({ error: 'type must be ncr or capa.' })
    return
  }
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [audit] = await db
    .select()
    .from(internalAudits)
    .where(and(eq(internalAudits.id, req.params.id as string), eq(internalAudits.organizationId, orgId)))
  if (!audit) {
    res.status(404).json({ error: 'Audit not found.' })
    return
  }

  const finding = audit.findings.trim() || audit.title
  const created = await createFormFromTemplate({
    orgId,
    userId: req.user?.id,
    slug: type,
    status: 'open',
    data:
      type === 'ncr'
        ? {
            description: finding,
            reportedBy: audit.auditor,
            department: 'Quality',
            productOrProcess: audit.scope || audit.title,
            owner: audit.auditor,
          }
        : {
            source: 'Internal audit',
            problemStatement: finding,
            initiatedBy: audit.auditor,
            owner: audit.auditor,
            containment: '',
            proposedAction: '',
          },
  })
  if (!created) {
    res.status(404).json({ error: `${type.toUpperCase()} template not found for this tenant.` })
    return
  }

  const kind = type === 'ncr' ? 'audit_ncr' : 'audit_capa'
  await db.insert(auditRecordLinks).values({
    id: randomUUID(),
    organizationId: orgId,
    auditId: audit.id,
    recordId: created.created.id,
    kind,
  })
  await writeAudit(orgId, req.user?.id, 'form_record', created.created.id, 'create', undefined, {
    fromAudit: audit.id,
    kind,
    data: created.data,
  })

  const [record] = await db.select().from(formRecords).where(eq(formRecords.id, created.created.id))
  res.status(201).json(await toRecordDetail(record, orgId))
})

api.get('/folders/:id/training', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, req.params.id as string), eq(folders.organizationId, orgId)))
  if (!folder) {
    res.status(404).json({ error: 'Folder not found.' })
    return
  }
  if (folder.slug !== 'competence-records') {
    res.status(400).json({ error: 'Training assignments are listed in Competence Records.' })
    return
  }

  const rows = await db
    .select({
      assignment: trainingAssignments,
      userName: users.name,
    })
    .from(trainingAssignments)
    .innerJoin(users, eq(users.id, trainingAssignments.userId))
    .where(eq(trainingAssignments.organizationId, orgId))

  res.json({
    assignments: rows
      .sort((a, b) => b.assignment.createdAt.getTime() - a.assignment.createdAt.getTime())
      .map((row) => toTrainingSummary(row.assignment, row.userName)),
  })
})

api.get('/training/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [row] = await db
    .select({
      assignment: trainingAssignments,
      userName: users.name,
    })
    .from(trainingAssignments)
    .innerJoin(users, eq(users.id, trainingAssignments.userId))
    .where(
      and(eq(trainingAssignments.id, req.params.id as string), eq(trainingAssignments.organizationId, orgId)),
    )
  if (!row) {
    res.status(404).json({ error: 'Training assignment not found.' })
    return
  }
  res.json(toTrainingSummary(row.assignment, row.userName))
})

api.post('/training/:id/complete', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [row] = await db
    .select({
      assignment: trainingAssignments,
      userName: users.name,
    })
    .from(trainingAssignments)
    .innerJoin(users, eq(users.id, trainingAssignments.userId))
    .where(
      and(eq(trainingAssignments.id, req.params.id as string), eq(trainingAssignments.organizationId, orgId)),
    )
  if (!row) {
    res.status(404).json({ error: 'Training assignment not found.' })
    return
  }
  if (row.assignment.userId !== req.user?.id) {
    res.status(403).json({ error: 'Only the assigned user can acknowledge this revision.' })
    return
  }
  if (row.assignment.status === 'stale') {
    res.status(409).json({ error: 'This assignment is stale. A newer revision was released.' })
    return
  }
  if (row.assignment.status === 'complete') {
    res.json(toTrainingSummary(row.assignment, row.userName))
    return
  }

  const now = new Date()
  await db
    .update(trainingAssignments)
    .set({ status: 'complete', completedAt: now })
    .where(and(eq(trainingAssignments.id, row.assignment.id), eq(trainingAssignments.organizationId, orgId)))
  const [updated] = await db
    .select()
    .from(trainingAssignments)
    .where(eq(trainingAssignments.id, row.assignment.id))
  await writeAudit(
    orgId,
    req.user?.id,
    'training_assignment',
    updated.id,
    'status',
    { status: row.assignment.status },
    { status: 'complete', revision: updated.revision },
  )
  res.json(toTrainingSummary(updated, row.userName))
})

api.patch('/records/:id/investigation', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!record) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, orgId)))
  if (template?.slug !== 'capa') {
    res.status(400).json({ error: 'Investigation is only available on CAPA records.' })
    return
  }

  const current = await loadCapaInvestigation(orgId, record.id)
  const rcaMethod = String(req.body?.rcaMethod ?? current.rcaMethod)
  if (!RCA_METHODS.includes(rcaMethod as (typeof RCA_METHODS)[number])) {
    res.status(400).json({ error: 'rcaMethod must be 5-why, fishbone, or other.' })
    return
  }
  const next = {
    rootCause: typeof req.body?.rootCause === 'string' ? req.body.rootCause : current.rootCause,
    rcaMethod: rcaMethod as CapaInvestigation['rcaMethod'],
    effectivenessPlan:
      typeof req.body?.effectivenessPlan === 'string' ? req.body.effectivenessPlan : current.effectivenessPlan,
    effectivenessResult:
      typeof req.body?.effectivenessResult === 'string'
        ? req.body.effectivenessResult
        : current.effectivenessResult,
    verifiedDate:
      typeof req.body?.verifiedDate === 'string' ? req.body.verifiedDate || null : current.verifiedDate,
  }

  const [existing] = await db
    .select()
    .from(capaInvestigations)
    .where(and(eq(capaInvestigations.organizationId, orgId), eq(capaInvestigations.recordId, record.id)))
  const now = new Date()
  if (existing) {
    await db
      .update(capaInvestigations)
      .set({ ...next, updatedAt: now })
      .where(and(eq(capaInvestigations.id, existing.id), eq(capaInvestigations.organizationId, orgId)))
  } else {
    await db.insert(capaInvestigations).values({
      id: randomUUID(),
      organizationId: orgId,
      recordId: record.id,
      ...next,
      updatedAt: now,
    })
  }

  await writeAudit(orgId, req.user?.id, 'form_record', record.id, 'update', { investigation: current }, { investigation: next })
  res.json(await loadCapaInvestigation(orgId, record.id))
})

api.post('/records/:id/actions', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, req.params.id as string), eq(formRecords.organizationId, orgId)))
  if (!record) {
    res.status(404).json({ error: 'Record not found.' })
    return
  }
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, orgId)))
  if (template?.slug !== 'capa') {
    res.status(400).json({ error: 'Actions are only available on CAPA records.' })
    return
  }

  const kind = String(req.body?.kind ?? 'corrective')
  if (!CAPA_ACTION_KINDS.includes(kind as (typeof CAPA_ACTION_KINDS)[number])) {
    res.status(400).json({ error: 'kind must be corrective or preventive.' })
    return
  }

  const id = randomUUID()
  const now = new Date()
  await db.insert(capaActions).values({
    id,
    organizationId: orgId,
    recordId: record.id,
    kind,
    description: String(req.body?.description ?? ''),
    owner: String(req.body?.owner ?? ''),
    dueDate: typeof req.body?.dueDate === 'string' && req.body.dueDate ? req.body.dueDate : null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  })
  await writeAudit(orgId, req.user?.id, 'capa_action', id, 'create', undefined, { recordId: record.id, kind })
  res.status(201).json(await loadCapaInvestigation(orgId, record.id))
})

api.patch('/actions/:id', requireAuth, async (req: AuthedRequest, res) => {
  const db = await getDb()
  const orgId = orgIdOf(req)
  const [action] = await db
    .select()
    .from(capaActions)
    .where(and(eq(capaActions.id, req.params.id as string), eq(capaActions.organizationId, orgId)))
  if (!action) {
    res.status(404).json({ error: 'Action not found.' })
    return
  }
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status : action.status
  if (!CAPA_ACTION_STATUSES.includes(nextStatus as (typeof CAPA_ACTION_STATUSES)[number])) {
    res.status(400).json({ error: 'status must be open or done.' })
    return
  }
  const nextKind = typeof req.body?.kind === 'string' ? req.body.kind : action.kind
  if (!CAPA_ACTION_KINDS.includes(nextKind as (typeof CAPA_ACTION_KINDS)[number])) {
    res.status(400).json({ error: 'kind must be corrective or preventive.' })
    return
  }

  await db
    .update(capaActions)
    .set({
      kind: nextKind,
      description: typeof req.body?.description === 'string' ? req.body.description : action.description,
      owner: typeof req.body?.owner === 'string' ? req.body.owner : action.owner,
      dueDate: typeof req.body?.dueDate === 'string' ? req.body.dueDate || null : action.dueDate,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(capaActions.id, action.id), eq(capaActions.organizationId, orgId)))

  res.json(await loadCapaInvestigation(orgId, action.recordId))
})

registerIsoRoutes(api)
registerDiRoutes(api)

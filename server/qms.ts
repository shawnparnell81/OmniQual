import { randomUUID } from 'node:crypto'
import { and, eq, inArray, or } from 'drizzle-orm'
import type {
  AuditFinding,
  AuditStatus,
  CalibrationDetail,
  CalibrationEvent,
  CalibrationStatus,
  CalibrationSummary,
  CapaAction,
  CapaInvestigation,
  DiscrepancyDetail,
  DiscrepancySummary,
  FormDataMap,
  FormRecordSummary,
  InspectionDetail,
  InspectionResult,
  InspectionSummary,
  InternalAuditDetail,
  InternalAuditSummary,
  LinkedItem,
  ManagementReviewDetail,
  ManagementReviewSummary,
  RecordLink,
  ReviewStatus,
  SupplierDetail,
  SupplierEvaluation,
  SupplierStatus,
  SupplierSummary,
  TrainingAssignmentSummary,
  TrainingCounts,
  TrainingStatus,
} from '../shared/types.ts'
import { getDb } from './db/client.ts'
import {
  auditFindings,
  auditRecordLinks,
  calibrationAssets,
  calibrationEvents,
  capaActions,
  capaInvestigations,
  discrepancyInvestigations,
  entityLinks,
  folders,
  formRecords,
  formTemplates,
  inspections,
  internalAudits,
  managementReviews,
  qualityRecordLinks,
  recordLinks,
  supplierEvaluations,
  suppliers,
  trainingAssignments,
  users,
  type AuditFinding as AuditFindingRow,
  type CalibrationAsset,
  type ControlledDocument,
  type DiscrepancyInvestigation,
  type FormRecord,
  type Inspection,
  type InternalAudit,
  type ManagementReview,
  type Supplier,
  type TrainingAssignment,
} from './db/schema.ts'

export function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

export function emptyTraining(): TrainingCounts {
  return { pending: 0, complete: 0, stale: 0 }
}

export function parseRoleList(value: string | null | undefined) {
  return String(value ?? '')
    .split(/[,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function addDays(stamp: string, days: number) {
  const date = new Date(`${stamp}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function toAuditSummary(row: InternalAudit): InternalAuditSummary {
  return {
    id: row.id,
    folderId: row.folderId,
    title: row.title,
    number: row.number,
    scope: row.scope,
    plannedDate: row.plannedDate ? String(row.plannedDate).slice(0, 10) : null,
    auditor: row.auditor,
    status: row.status as AuditStatus,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function loadAuditRecordLinks(orgId: string, auditId: string): Promise<RecordLink[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(auditRecordLinks)
    .where(and(eq(auditRecordLinks.organizationId, orgId), eq(auditRecordLinks.auditId, auditId)))
  const recordIds = rows.map((row) => row.recordId)
  const related = recordIds.length
    ? await db
        .select()
        .from(formRecords)
        .where(and(eq(formRecords.organizationId, orgId), inArray(formRecords.id, recordIds)))
    : []
  const byId = new Map(related.map((row) => [row.id, row]))
  return rows.flatMap((row) => {
    const other = byId.get(row.recordId)
    if (!other) return []
    return [
      {
        id: row.id,
        recordId: other.id,
        folderId: other.folderId,
        title: other.title,
        status: other.status,
        kind: row.kind,
        direction: 'from' as const,
      } satisfies RecordLink,
    ]
  })
}

export async function toAuditDetail(row: InternalAudit, orgId: string): Promise<InternalAuditDetail> {
  return {
    ...toAuditSummary(row),
    findings: row.findings,
    structuredFindings: await loadAuditFindings(orgId, row.id),
    links: await loadAuditRecordLinks(orgId, row.id),
    related: await collectRelated(orgId, 'audit', row.id),
  }
}

export function toTrainingSummary(
  row: TrainingAssignment,
  userName: string,
): TrainingAssignmentSummary {
  return {
    id: row.id,
    documentId: row.documentId,
    userId: row.userId,
    userName,
    documentNumber: row.documentNumber,
    revision: row.revision,
    documentTitle: row.documentTitle,
    status: row.status as TrainingStatus,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function trainingCountsFor(orgId: string, documentId: string): Promise<TrainingCounts> {
  const map = await trainingCountsByDocumentIds(orgId, [documentId])
  return map.get(documentId) ?? emptyTraining()
}

export async function trainingCountsByDocumentIds(
  orgId: string,
  documentIds: string[],
): Promise<Map<string, TrainingCounts>> {
  const map = new Map<string, TrainingCounts>()
  for (const id of documentIds) map.set(id, emptyTraining())
  if (documentIds.length === 0) return map
  const db = await getDb()
  const rows = await db
    .select()
    .from(trainingAssignments)
    .where(
      and(eq(trainingAssignments.organizationId, orgId), inArray(trainingAssignments.documentId, documentIds)),
    )
  for (const row of rows) {
    const counts = map.get(row.documentId) ?? emptyTraining()
    if (row.status === 'pending' || row.status === 'complete' || row.status === 'stale') {
      counts[row.status] += 1
    }
    map.set(row.documentId, counts)
  }
  return map
}

export async function assignTrainingOnRelease(orgId: string, doc: ControlledDocument) {
  const db = await getDb()
  const prior = await db
    .select()
    .from(trainingAssignments)
    .where(
      and(eq(trainingAssignments.organizationId, orgId), eq(trainingAssignments.documentNumber, doc.number)),
    )
  for (const assignment of prior) {
    if (assignment.status === 'stale') continue
    await db
      .update(trainingAssignments)
      .set({ status: 'stale' })
      .where(
        and(eq(trainingAssignments.id, assignment.id), eq(trainingAssignments.organizationId, orgId)),
      )
  }

  const orgUsers = await db.select().from(users).where(eq(users.organizationId, orgId))
  const required = parseRoleList(doc.trainingRoles)
  const matched =
    required.length === 0
      ? orgUsers
      : orgUsers.filter((user) => required.includes(user.department.trim().toLowerCase()))
  const targets = matched.length > 0 ? matched : orgUsers
  const now = new Date()
  for (const user of targets) {
    await db.insert(trainingAssignments).values({
      id: randomUUID(),
      organizationId: orgId,
      documentId: doc.id,
      userId: user.id,
      documentNumber: doc.number,
      revision: doc.revision,
      documentTitle: doc.title,
      status: 'pending',
      completedAt: null,
      createdAt: now,
    })
  }
  return targets.length
}

export async function loadCapaInvestigation(
  orgId: string,
  recordId: string,
): Promise<CapaInvestigation> {
  const db = await getDb()
  const [inv] = await db
    .select()
    .from(capaInvestigations)
    .where(and(eq(capaInvestigations.organizationId, orgId), eq(capaInvestigations.recordId, recordId)))
  const actionRows = await db
    .select()
    .from(capaActions)
    .where(and(eq(capaActions.organizationId, orgId), eq(capaActions.recordId, recordId)))
  const method = inv?.rcaMethod
  return {
    rootCause: inv?.rootCause ?? '',
    rcaMethod: method === 'fishbone' || method === 'other' || method === '5-why' ? method : '5-why',
    effectivenessPlan: inv?.effectivenessPlan ?? '',
    effectivenessResult: inv?.effectivenessResult ?? '',
    verifiedDate: inv?.verifiedDate ? String(inv.verifiedDate).slice(0, 10) : null,
    actions: actionRows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(
        (row) =>
          ({
            id: row.id,
            kind: row.kind === 'preventive' ? 'preventive' : 'corrective',
            description: row.description,
            owner: row.owner,
            dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : null,
            status: row.status === 'done' ? 'done' : 'open',
          }) satisfies CapaAction,
      ),
  }
}

export async function capaCanClose(orgId: string, recordId: string) {
  const investigation = await loadCapaInvestigation(orgId, recordId)
  return investigation.actions.length > 0 && investigation.effectivenessResult.trim().length > 0
}

export async function createFormFromTemplate(opts: {
  orgId: string
  userId?: string
  slug: 'ncr' | 'capa'
  data: FormDataMap
  status?: string
}) {
  const db = await getDb()
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.slug, opts.slug), eq(formTemplates.organizationId, opts.orgId)))
  if (!template) return null

  const existing = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.templateId, template.id), eq(formRecords.organizationId, opts.orgId)))
  const seq = String(existing.length + 1).padStart(4, '0')
  const prefix = template.schemaJson.formCode.replace(/^QMS-/, '').replace(/-\d+$/, '')
  const number = `${prefix}-${seq}`
  const numberField = template.schemaJson.fields.find((field) => /number/i.test(field.id))
  const dateField = template.schemaJson.fields.find((field) => field.type === 'date')
  const data: FormDataMap = { ...opts.data }
  if (numberField && !data[numberField.id]) data[numberField.id] = number
  if (dateField && !data[dateField.id]) data[dateField.id] = todayStamp()

  const id = randomUUID()
  const now = new Date()
  await db.insert(formRecords).values({
    id,
    organizationId: opts.orgId,
    templateId: template.id,
    folderId: template.folderId,
    title: number,
    data,
    status: opts.status ?? 'open',
    createdBy: opts.userId,
    createdAt: now,
    updatedAt: now,
  })
  const [created] = await db.select().from(formRecords).where(eq(formRecords.id, id))
  return { created, data, number }
}

export function dateStamp(value: string | Date | null | undefined) {
  if (!value) return null
  return String(value).slice(0, 10)
}

export async function loadQualityRecordLinks(
  orgId: string,
  sourceType: string,
  sourceId: string,
): Promise<RecordLink[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(qualityRecordLinks)
    .where(
      and(
        eq(qualityRecordLinks.organizationId, orgId),
        eq(qualityRecordLinks.sourceType, sourceType),
        eq(qualityRecordLinks.sourceId, sourceId),
      ),
    )
  const recordIds = rows.map((row) => row.recordId)
  const related = recordIds.length
    ? await db
        .select()
        .from(formRecords)
        .where(and(eq(formRecords.organizationId, orgId), inArray(formRecords.id, recordIds)))
    : []
  const byId = new Map(related.map((row) => [row.id, row]))
  return rows.flatMap((row) => {
    const other = byId.get(row.recordId)
    if (!other) return []
    return [
      {
        id: row.id,
        recordId: other.id,
        folderId: other.folderId,
        title: other.title,
        status: other.status,
        kind: row.kind,
        direction: 'from' as const,
      } satisfies RecordLink,
    ]
  })
}

export async function insertQualityLink(opts: {
  orgId: string
  sourceType: string
  sourceId: string
  recordId: string
  kind: string
}) {
  const db = await getDb()
  const [existing] = await db
    .select()
    .from(qualityRecordLinks)
    .where(
      and(
        eq(qualityRecordLinks.organizationId, opts.orgId),
        eq(qualityRecordLinks.sourceType, opts.sourceType),
        eq(qualityRecordLinks.sourceId, opts.sourceId),
        eq(qualityRecordLinks.recordId, opts.recordId),
        eq(qualityRecordLinks.kind, opts.kind),
      ),
    )
  if (existing) return
  await db.insert(qualityRecordLinks).values({
    id: randomUUID(),
    organizationId: opts.orgId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    recordId: opts.recordId,
    kind: opts.kind,
  })
}

export async function insertAuditRecordLink(opts: {
  orgId: string
  auditId: string
  recordId: string
  kind: string
}) {
  const db = await getDb()
  const [existing] = await db
    .select()
    .from(auditRecordLinks)
    .where(
      and(
        eq(auditRecordLinks.organizationId, opts.orgId),
        eq(auditRecordLinks.auditId, opts.auditId),
        eq(auditRecordLinks.recordId, opts.recordId),
        eq(auditRecordLinks.kind, opts.kind),
      ),
    )
  if (existing) return
  await db.insert(auditRecordLinks).values({
    id: randomUUID(),
    organizationId: opts.orgId,
    auditId: opts.auditId,
    recordId: opts.recordId,
    kind: opts.kind,
  })
}

export async function insertFormRecordLink(opts: {
  orgId: string
  fromRecordId: string
  toRecordId: string
  kind: string
}) {
  const db = await getDb()
  const [existing] = await db
    .select()
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.organizationId, opts.orgId),
        eq(recordLinks.fromRecordId, opts.fromRecordId),
        eq(recordLinks.toRecordId, opts.toRecordId),
        eq(recordLinks.kind, opts.kind),
      ),
    )
  if (existing) return
  await db.insert(recordLinks).values({
    id: randomUUID(),
    organizationId: opts.orgId,
    fromRecordId: opts.fromRecordId,
    toRecordId: opts.toRecordId,
    kind: opts.kind,
  })
}

export function computeCalibrationStatus(row: {
  status: string
  nextDue: string | Date | null
}): CalibrationStatus {
  if (row.status === 'out_of_service') return 'out_of_service'
  const nextDue = dateStamp(row.nextDue)
  const today = todayStamp()
  if (!nextDue || nextDue < today) return nextDue && nextDue < today ? 'overdue' : 'due_soon'
  if (nextDue <= addDays(today, 30)) return 'due_soon'
  return 'current'
}

export function toCalibrationSummary(row: CalibrationAsset): CalibrationSummary {
  const lastCalibrated = dateStamp(row.lastCalibrated)
  const nextDue = dateStamp(row.nextDue)
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    number: row.number,
    location: row.location,
    intervalDays: row.intervalDays,
    lastCalibrated,
    nextDue,
    status: computeCalibrationStatus({ status: row.status, nextDue }),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function toCalibrationDetail(row: CalibrationAsset, orgId: string): Promise<CalibrationDetail> {
  const db = await getDb()
  const events = await db
    .select()
    .from(calibrationEvents)
    .where(and(eq(calibrationEvents.organizationId, orgId), eq(calibrationEvents.assetId, row.id)))
  return {
    ...toCalibrationSummary(row),
    events: events
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((event) => ({
        id: event.id,
        eventDate: dateStamp(event.eventDate) ?? '',
        result: event.result as CalibrationEvent['result'],
        notes: event.notes,
        asFound: event.asFound ?? '',
        asLeft: event.asLeft ?? '',
        technician: event.technician ?? '',
        certificate: event.certificate ?? '',
        createdAt: event.createdAt.toISOString(),
      })),
    links: await loadQualityRecordLinks(orgId, 'calibration', row.id),
    related: await collectRelated(orgId, 'calibration', row.id),
  }
}

export function toSupplierSummary(row: Supplier): SupplierSummary {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    number: row.number,
    status: row.status as SupplierStatus,
    lastEvaluationDate: dateStamp(row.lastEvaluationDate),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function toSupplierDetail(row: Supplier, orgId: string): Promise<SupplierDetail> {
  const db = await getDb()
  const evaluations = await db
    .select()
    .from(supplierEvaluations)
    .where(and(eq(supplierEvaluations.organizationId, orgId), eq(supplierEvaluations.supplierId, row.id)))
  return {
    ...toSupplierSummary(row),
    notes: row.notes,
    evaluations: evaluations
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((item) => ({
        id: item.id,
        evalDate: dateStamp(item.evalDate) ?? '',
        result: item.result as SupplierEvaluation['result'],
        score: item.score,
        comments: item.comments,
        createdAt: item.createdAt.toISOString(),
      })),
    links: await loadQualityRecordLinks(orgId, 'supplier', row.id),
    related: await collectRelated(orgId, 'supplier', row.id),
  }
}

export function toReviewSummary(row: ManagementReview): ManagementReviewSummary {
  return {
    id: row.id,
    folderId: row.folderId,
    number: row.number,
    meetingDate: dateStamp(row.meetingDate),
    status: row.status as ReviewStatus,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function toReviewDetail(row: ManagementReview, orgId: string): Promise<ManagementReviewDetail> {
  return {
    ...toReviewSummary(row),
    attendees: row.attendees,
    inputsSummary: row.inputsSummary,
    outputsActions: row.outputsActions,
    links: await loadQualityRecordLinks(orgId, 'management_review', row.id),
    related: await collectRelated(orgId, 'management_review', row.id),
  }
}

export function toFinding(row: AuditFindingRow): AuditFinding {
  const severity = row.severity
  return {
    id: row.id,
    auditId: row.auditId,
    severity: severity === 'minor' || severity === 'major' || severity === 'observation' ? severity : 'observation',
    clause: row.clause,
    description: row.description,
    evidence: row.evidence,
    discrepancyId: row.discrepancyId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function loadAuditFindings(orgId: string, auditId: string): Promise<AuditFinding[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(auditFindings)
    .where(and(eq(auditFindings.organizationId, orgId), eq(auditFindings.auditId, auditId)))
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toFinding)
}

export function toDiscrepancySummary(row: DiscrepancyInvestigation): DiscrepancySummary {
  return {
    id: row.id,
    folderId: row.folderId,
    findingId: row.findingId,
    number: row.number,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function toDiscrepancyDetail(
  row: DiscrepancyInvestigation,
  orgId: string,
): Promise<DiscrepancyDetail> {
  return {
    ...toDiscrepancySummary(row),
    identification: row.identification,
    containment: row.containment,
    investigation: row.investigation,
    disposition: row.disposition,
    related: await collectRelated(orgId, 'discrepancy', row.id),
  }
}

export function toInspectionSummary(row: Inspection): InspectionSummary {
  const result = row.result
  return {
    id: row.id,
    folderId: row.folderId,
    number: row.number,
    title: row.title,
    area: row.area,
    inspector: row.inspector,
    inspectedAt: dateStamp(row.inspectedAt),
    result: result === 'pass' || result === 'fail' ? result : 'pending',
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function toInspectionDetail(row: Inspection, orgId: string): Promise<InspectionDetail> {
  return {
    ...toInspectionSummary(row),
    notes: row.notes,
    related: await collectRelated(orgId, 'inspection', row.id),
  }
}

export async function linkEntities(opts: {
  orgId: string
  fromKind: string
  fromId: string
  toKind: string
  toId: string
  kind: string
}) {
  const db = await getDb()
  const [existing] = await db
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.organizationId, opts.orgId),
        eq(entityLinks.fromKind, opts.fromKind),
        eq(entityLinks.fromId, opts.fromId),
        eq(entityLinks.toKind, opts.toKind),
        eq(entityLinks.toId, opts.toId),
        eq(entityLinks.kind, opts.kind),
      ),
    )
  if (existing) return
  await db.insert(entityLinks).values({
    id: randomUUID(),
    organizationId: opts.orgId,
    fromKind: opts.fromKind,
    fromId: opts.fromId,
    toKind: opts.toKind,
    toId: opts.toId,
    kind: opts.kind,
  })
}

export const ATTACH_SOURCE_KINDS = ['discrepancy', 'audit', 'calibration', 'inspection', 'ncr'] as const
export type AttachSourceKind = (typeof ATTACH_SOURCE_KINDS)[number]
export type AttachRecordType = 'ncr' | 'capa'

const FORM_KIND_ALIASES = ['form', 'ncr', 'capa', 'record']

function haystackForRecord(row: { title: string; data: FormDataMap }) {
  const values = Object.values(row.data).map((value) =>
    typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
  )
  return `${row.title} ${values.join(' ')}`.toLowerCase()
}

function sourceKindAliases(sourceKind: AttachSourceKind) {
  if (sourceKind === 'ncr') return FORM_KIND_ALIASES
  return [sourceKind]
}

export async function linkedFormRecordIds(opts: {
  orgId: string
  sourceKind: AttachSourceKind
  sourceId: string
}) {
  const db = await getDb()
  const ids = new Set<string>()
  const aliases = sourceKindAliases(opts.sourceKind)
  const edgeClauses = aliases.flatMap((kind) => [
    and(eq(entityLinks.fromKind, kind), eq(entityLinks.fromId, opts.sourceId)),
    and(eq(entityLinks.toKind, kind), eq(entityLinks.toId, opts.sourceId)),
  ])
  const edges = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.organizationId, opts.orgId), or(...edgeClauses)))
  for (const edge of edges) {
    if (aliases.includes(edge.fromKind) && edge.fromId === opts.sourceId && FORM_KIND_ALIASES.includes(edge.toKind)) {
      ids.add(edge.toId)
    }
    if (aliases.includes(edge.toKind) && edge.toId === opts.sourceId && FORM_KIND_ALIASES.includes(edge.fromKind)) {
      ids.add(edge.fromId)
    }
  }

  if (opts.sourceKind !== 'ncr') {
    const quality = await db
      .select()
      .from(qualityRecordLinks)
      .where(
        and(
          eq(qualityRecordLinks.organizationId, opts.orgId),
          eq(qualityRecordLinks.sourceType, opts.sourceKind),
          eq(qualityRecordLinks.sourceId, opts.sourceId),
        ),
      )
    for (const link of quality) ids.add(link.recordId)
  }

  if (opts.sourceKind === 'audit') {
    const auditLinks = await db
      .select()
      .from(auditRecordLinks)
      .where(and(eq(auditRecordLinks.organizationId, opts.orgId), eq(auditRecordLinks.auditId, opts.sourceId)))
    for (const link of auditLinks) ids.add(link.recordId)
  }

  if (opts.sourceKind === 'ncr') {
    const recLinks = await db
      .select()
      .from(recordLinks)
      .where(
        and(
          eq(recordLinks.organizationId, opts.orgId),
          or(eq(recordLinks.fromRecordId, opts.sourceId), eq(recordLinks.toRecordId, opts.sourceId)),
        ),
      )
    for (const link of recLinks) {
      ids.add(link.fromRecordId === opts.sourceId ? link.toRecordId : link.fromRecordId)
    }
    ids.add(opts.sourceId)
  }

  return ids
}

export async function searchAttachableRecords(opts: {
  orgId: string
  type: AttachRecordType
  q?: string
  sourceKind: AttachSourceKind
  sourceId: string
  limit?: number
}): Promise<FormRecordSummary[]> {
  const db = await getDb()
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.organizationId, opts.orgId), eq(formTemplates.slug, opts.type)))
  if (!template) return []

  const rows = await db
    .select()
    .from(formRecords)
    .where(
      and(
        eq(formRecords.organizationId, opts.orgId),
        eq(formRecords.templateId, template.id),
        inArray(formRecords.status, ['open', 'draft']),
      ),
    )
  const excluded = await linkedFormRecordIds({
    orgId: opts.orgId,
    sourceKind: opts.sourceKind,
    sourceId: opts.sourceId,
  })
  const needle = (opts.q ?? '').trim().toLowerCase()
  return rows
    .filter((row) => !excluded.has(row.id))
    .filter((row) => !needle || haystackForRecord(row).includes(needle))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      templateId: row.templateId,
      folderId: row.folderId,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }))
}

function linkKindFor(sourceKind: AttachSourceKind, type: AttachRecordType) {
  if (sourceKind === 'ncr') return type === 'capa' ? 'ncr_capa' : null
  if (sourceKind === 'discrepancy') return type === 'ncr' ? 'di_ncr' : 'di_capa'
  if (sourceKind === 'audit') return type === 'ncr' ? 'audit_ncr' : 'audit_capa'
  if (sourceKind === 'calibration') return type === 'ncr' ? 'calibration_ncr' : null
  if (sourceKind === 'inspection') return type === 'ncr' ? 'inspection_ncr' : 'inspection_capa'
  return null
}

async function sourceExistsInOrg(orgId: string, sourceKind: AttachSourceKind, sourceId: string) {
  const db = await getDb()
  if (sourceKind === 'discrepancy') {
    const [row] = await db
      .select({ id: discrepancyInvestigations.id })
      .from(discrepancyInvestigations)
      .where(and(eq(discrepancyInvestigations.id, sourceId), eq(discrepancyInvestigations.organizationId, orgId)))
    return Boolean(row)
  }
  if (sourceKind === 'audit') {
    const [row] = await db
      .select({ id: internalAudits.id })
      .from(internalAudits)
      .where(and(eq(internalAudits.id, sourceId), eq(internalAudits.organizationId, orgId)))
    return Boolean(row)
  }
  if (sourceKind === 'calibration') {
    const [row] = await db
      .select({ id: calibrationAssets.id })
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, sourceId), eq(calibrationAssets.organizationId, orgId)))
    return Boolean(row)
  }
  if (sourceKind === 'inspection') {
    const [row] = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(and(eq(inspections.id, sourceId), eq(inspections.organizationId, orgId)))
    return Boolean(row)
  }
  const [row] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, sourceId), eq(formRecords.organizationId, orgId)))
  if (!row) return false
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, row.templateId), eq(formTemplates.organizationId, orgId)))
  return template?.slug === 'ncr'
}

export async function attachExistingRecord(opts: {
  orgId: string
  type: AttachRecordType
  recordId: string
  sourceKind: AttachSourceKind
  sourceId: string
}): Promise<{ ok: true; record: FormRecord } | { ok: false; status: number; error: string }> {
  const kind = linkKindFor(opts.sourceKind, opts.type)
  if (!kind) {
    return { ok: false, status: 400, error: `Cannot attach a ${opts.type.toUpperCase()} to this record.` }
  }
  if (opts.sourceKind === 'ncr' && opts.recordId === opts.sourceId) {
    return { ok: false, status: 400, error: 'A record cannot be linked to itself.' }
  }
  if (!(await sourceExistsInOrg(opts.orgId, opts.sourceKind, opts.sourceId))) {
    return { ok: false, status: 404, error: 'Source record not found.' }
  }

  const db = await getDb()
  const [record] = await db
    .select()
    .from(formRecords)
    .where(and(eq(formRecords.id, opts.recordId), eq(formRecords.organizationId, opts.orgId)))
  if (!record) {
    return { ok: false, status: 404, error: `${opts.type.toUpperCase()} not found.` }
  }
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.id, record.templateId), eq(formTemplates.organizationId, opts.orgId)))
  if (!template || template.slug !== opts.type) {
    return { ok: false, status: 400, error: `Record is not an open ${opts.type.toUpperCase()}.` }
  }
  if (record.status !== 'open' && record.status !== 'draft') {
    return { ok: false, status: 400, error: `Only open or draft ${opts.type.toUpperCase()} records can be attached.` }
  }

  await linkEntities({
    orgId: opts.orgId,
    fromKind: opts.sourceKind,
    fromId: opts.sourceId,
    toKind: opts.type,
    toId: record.id,
    kind,
  })

  if (opts.sourceKind === 'audit') {
    await insertAuditRecordLink({
      orgId: opts.orgId,
      auditId: opts.sourceId,
      recordId: record.id,
      kind,
    })
  } else if (opts.sourceKind === 'ncr') {
    await insertFormRecordLink({
      orgId: opts.orgId,
      fromRecordId: opts.sourceId,
      toRecordId: record.id,
      kind,
    })
    const [source] = await db
      .select()
      .from(formRecords)
      .where(and(eq(formRecords.id, opts.sourceId), eq(formRecords.organizationId, opts.orgId)))
    if (source?.status === 'draft') {
      await db
        .update(formRecords)
        .set({ status: 'open', updatedAt: new Date() })
        .where(and(eq(formRecords.id, source.id), eq(formRecords.organizationId, opts.orgId)))
    }
  } else {
    await insertQualityLink({
      orgId: opts.orgId,
      sourceType: opts.sourceKind,
      sourceId: opts.sourceId,
      recordId: record.id,
      kind,
    })
  }

  return { ok: true, record }
}

async function resolveLinkedItem(orgId: string, kind: string, id: string): Promise<LinkedItem | null> {
  const db = await getDb()
  if (kind === 'audit') {
    const [row] = await db
      .select()
      .from(internalAudits)
      .where(and(eq(internalAudits.id, id), eq(internalAudits.organizationId, orgId)))
    if (!row) return null
    return { id: row.id, kind: 'audit', title: row.number, status: row.status, folderId: row.folderId, auditId: row.id }
  }
  if (kind === 'finding') {
    const [row] = await db
      .select()
      .from(auditFindings)
      .where(and(eq(auditFindings.id, id), eq(auditFindings.organizationId, orgId)))
    if (!row) return null
    return {
      id: row.id,
      kind: 'finding',
      title: `${row.severity.toUpperCase()} · ${row.clause || 'finding'}`,
      status: row.severity,
      auditId: row.auditId,
      findingId: row.id,
      discrepancyId: row.discrepancyId ?? undefined,
    }
  }
  if (kind === 'discrepancy') {
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(and(eq(discrepancyInvestigations.id, id), eq(discrepancyInvestigations.organizationId, orgId)))
    if (!row) return null
    return {
      id: row.id,
      kind: 'discrepancy',
      title: row.number,
      status: row.status,
      folderId: row.folderId,
      discrepancyId: row.id,
      findingId: row.findingId,
    }
  }
  if (kind === 'calibration') {
    const [row] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, id), eq(calibrationAssets.organizationId, orgId)))
    if (!row) return null
    return {
      id: row.id,
      kind: 'calibration',
      title: row.number,
      status: computeCalibrationStatus({ status: row.status, nextDue: row.nextDue }),
      folderId: row.folderId,
      calibrationId: row.id,
    }
  }
  if (kind === 'ncr' || kind === 'capa' || kind === 'form') {
    const [row] = await db
      .select()
      .from(formRecords)
      .where(and(eq(formRecords.id, id), eq(formRecords.organizationId, orgId)))
    if (!row) return null
    const [template] = await db
      .select()
      .from(formTemplates)
      .where(and(eq(formTemplates.id, row.templateId), eq(formTemplates.organizationId, orgId)))
    const slug = template?.slug ?? 'form'
    return {
      id: row.id,
      kind: slug === 'ncr' || slug === 'capa' ? slug : 'form',
      title: row.title,
      status: row.status,
      folderId: row.folderId,
      recordId: row.id,
    }
  }
  if (kind === 'inspection') {
    const [row] = await db
      .select()
      .from(inspections)
      .where(and(eq(inspections.id, id), eq(inspections.organizationId, orgId)))
    if (!row) return null
    return {
      id: row.id,
      kind: 'inspection',
      title: row.number,
      status: row.result,
      folderId: row.folderId,
      inspectionId: row.id,
    }
  }
  if (kind === 'supplier') {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, orgId)))
    if (!row) return null
    return { id: row.id, kind: 'supplier', title: row.number, status: row.status, folderId: row.folderId }
  }
  if (kind === 'management_review') {
    const [row] = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.id, id), eq(managementReviews.organizationId, orgId)))
    if (!row) return null
    return { id: row.id, kind: 'review', title: row.number, status: row.status, folderId: row.folderId }
  }
  if (kind === 'record') {
    return resolveLinkedItem(orgId, 'form', id)
  }
  return null
}

export async function collectRelated(orgId: string, kind: string, id: string): Promise<LinkedItem[]> {
  const db = await getDb()
  const found = new Map<string, LinkedItem>()
  const queue: Array<{ kind: string; id: string }> = [{ kind, id }]
  const seen = new Set<string>()

    function aliases(entityKind: string) {
    if (entityKind === 'form' || entityKind === 'ncr' || entityKind === 'capa' || entityKind === 'record') {
      return ['form', 'ncr', 'capa', 'record']
    }
    if (entityKind === 'review' || entityKind === 'management_review') {
      return ['review', 'management_review']
    }
    return [entityKind]
  }

  function seenKey(entityKind: string, entityId: string) {
    return `${aliases(entityKind)[0]}:${entityId}`
  }

  async function enqueue(nextKind: string, nextId: string | null | undefined) {
    if (!nextKind || !nextId) return
    const key = seenKey(nextKind, nextId)
    if (seen.has(key)) return
    seen.add(key)
    if (nextId === id && aliases(nextKind).includes(kind)) return
    const item = await resolveLinkedItem(orgId, nextKind, nextId)
    if (!item || item.id === id) return
    found.set(`${item.kind}:${item.id}`, item)
    if (queue.length < 24) queue.push({ kind: nextKind, id: nextId })
  }

  seen.add(seenKey(kind, id))

  while (queue.length > 0) {
    const current = queue.shift()!
    const hops = [...queue].length
    if (hops > 40) break

    const kinds = aliases(current.kind)
    const edgeClauses = kinds.flatMap((entityKind) => [
      and(eq(entityLinks.fromKind, entityKind), eq(entityLinks.fromId, current.id)),
      and(eq(entityLinks.toKind, entityKind), eq(entityLinks.toId, current.id)),
    ])
    const edges = await db
      .select()
      .from(entityLinks)
      .where(and(eq(entityLinks.organizationId, orgId), or(...edgeClauses)))
    for (const edge of edges) {
      if (kinds.includes(edge.fromKind) && edge.fromId === current.id) await enqueue(edge.toKind, edge.toId)
      if (kinds.includes(edge.toKind) && edge.toId === current.id) await enqueue(edge.fromKind, edge.fromId)
    }

    if (current.kind === 'audit') {
      for (const finding of await loadAuditFindings(orgId, current.id)) {
        await enqueue('finding', finding.id)
        if (finding.discrepancyId) await enqueue('discrepancy', finding.discrepancyId)
      }
      const auditForms = await db
        .select()
        .from(auditRecordLinks)
        .where(and(eq(auditRecordLinks.organizationId, orgId), eq(auditRecordLinks.auditId, current.id)))
      for (const link of auditForms) await enqueue('form', link.recordId)
    }

    if (current.kind === 'finding') {
      const [finding] = await db
        .select()
        .from(auditFindings)
        .where(and(eq(auditFindings.id, current.id), eq(auditFindings.organizationId, orgId)))
      if (finding) {
        await enqueue('audit', finding.auditId)
        if (finding.discrepancyId) await enqueue('discrepancy', finding.discrepancyId)
      }
    }

    if (current.kind === 'discrepancy') {
      const [di] = await db
        .select()
        .from(discrepancyInvestigations)
        .where(and(eq(discrepancyInvestigations.id, current.id), eq(discrepancyInvestigations.organizationId, orgId)))
      if (di?.findingId) await enqueue('finding', di.findingId)
    }

    if (current.kind === 'form' || current.kind === 'ncr' || current.kind === 'capa') {
      const recLinks = await db
        .select()
        .from(recordLinks)
        .where(
          and(
            eq(recordLinks.organizationId, orgId),
            or(eq(recordLinks.fromRecordId, current.id), eq(recordLinks.toRecordId, current.id)),
          ),
        )
      for (const link of recLinks) {
        const other = link.fromRecordId === current.id ? link.toRecordId : link.fromRecordId
        await enqueue('form', other)
      }
      const sourced = await db
        .select()
        .from(qualityRecordLinks)
        .where(and(eq(qualityRecordLinks.organizationId, orgId), eq(qualityRecordLinks.recordId, current.id)))
      for (const link of sourced) await enqueue(link.sourceType, link.sourceId)
      const fromAudits = await db
        .select()
        .from(auditRecordLinks)
        .where(and(eq(auditRecordLinks.organizationId, orgId), eq(auditRecordLinks.recordId, current.id)))
      for (const link of fromAudits) await enqueue('audit', link.auditId)
    }

    if (current.kind === 'calibration' || current.kind === 'supplier' || current.kind === 'management_review' || current.kind === 'inspection') {
      const sourced = await db
        .select()
        .from(qualityRecordLinks)
        .where(
          and(
            eq(qualityRecordLinks.organizationId, orgId),
            eq(qualityRecordLinks.sourceType, current.kind),
            eq(qualityRecordLinks.sourceId, current.id),
          ),
        )
      for (const link of sourced) await enqueue('form', link.recordId)
    }
  }

  return [...found.values()].filter((item) => item.id !== id)
}

export async function folderIdForSlug(orgId: string, slug: string) {
  const db = await getDb()
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.organizationId, orgId), eq(folders.slug, slug)))
  return folder?.id ?? null
}

export async function ensureDiscrepancyForFinding(opts: {
  orgId: string
  userId?: string
  finding: AuditFindingRow
}) {
  const db = await getDb()
  const [existing] = await db
    .select()
    .from(discrepancyInvestigations)
    .where(
      and(
        eq(discrepancyInvestigations.organizationId, opts.orgId),
        eq(discrepancyInvestigations.findingId, opts.finding.id),
      ),
    )
  if (existing) return existing

  const folderId =
    (await folderIdForSlug(opts.orgId, 'discrepancy')) ??
    (await folderIdForSlug(opts.orgId, 'ncr')) ??
    (await folderIdForSlug(opts.orgId, 'audits'))
  if (!folderId) return null

  const all = await db
    .select()
    .from(discrepancyInvestigations)
    .where(eq(discrepancyInvestigations.organizationId, opts.orgId))
  const number = `DI-${String(all.length + 1).padStart(4, '0')}`
  const id = randomUUID()
  const now = new Date()
  const identification = `${opts.finding.severity.toUpperCase()} — ${opts.finding.clause || 'ISO 9001'}: ${opts.finding.description}`
  await db.insert(discrepancyInvestigations).values({
    id,
    organizationId: opts.orgId,
    folderId,
    findingId: opts.finding.id,
    number,
    identification,
    containment: '',
    investigation: '',
    disposition: '',
    status: 'open',
    createdBy: opts.userId,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .update(auditFindings)
    .set({ discrepancyId: id, updatedAt: now })
    .where(and(eq(auditFindings.id, opts.finding.id), eq(auditFindings.organizationId, opts.orgId)))

  await linkEntities({
    orgId: opts.orgId,
    fromKind: 'finding',
    fromId: opts.finding.id,
    toKind: 'discrepancy',
    toId: id,
    kind: 'finding_di',
  })
  await linkEntities({
    orgId: opts.orgId,
    fromKind: 'audit',
    fromId: opts.finding.auditId,
    toKind: 'discrepancy',
    toId: id,
    kind: 'audit_di',
  })

  const [created] = await db.select().from(discrepancyInvestigations).where(eq(discrepancyInvestigations.id, id))
  return created
}

export async function ensureDiscrepancyForSource(opts: {
  orgId: string
  userId?: string
  sourceKind: string
  sourceId: string
  identification: string
  containment?: string
}) {
  const db = await getDb()
  const [existingLink] = await db
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.organizationId, opts.orgId),
        eq(entityLinks.fromKind, opts.sourceKind),
        eq(entityLinks.fromId, opts.sourceId),
        eq(entityLinks.toKind, 'discrepancy'),
      ),
    )
  if (existingLink) {
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(
        and(eq(discrepancyInvestigations.id, existingLink.toId), eq(discrepancyInvestigations.organizationId, opts.orgId)),
      )
    if (row) return row
  }
  const [reverse] = await db
    .select()
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.organizationId, opts.orgId),
        eq(entityLinks.toKind, opts.sourceKind),
        eq(entityLinks.toId, opts.sourceId),
        eq(entityLinks.fromKind, 'discrepancy'),
      ),
    )
  if (reverse) {
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(
        and(eq(discrepancyInvestigations.id, reverse.fromId), eq(discrepancyInvestigations.organizationId, opts.orgId)),
      )
    if (row) return row
  }

  const folderId =
    (await folderIdForSlug(opts.orgId, 'discrepancy')) ??
    (await folderIdForSlug(opts.orgId, 'ncr')) ??
    (await folderIdForSlug(opts.orgId, 'inspections'))
  if (!folderId) return null

  const all = await db
    .select()
    .from(discrepancyInvestigations)
    .where(eq(discrepancyInvestigations.organizationId, opts.orgId))
  const number = `DI-${String(all.length + 1).padStart(4, '0')}`
  const id = randomUUID()
  const now = new Date()
  await db.insert(discrepancyInvestigations).values({
    id,
    organizationId: opts.orgId,
    folderId,
    findingId: null,
    number,
    identification: opts.identification,
    containment: opts.containment ?? '',
    investigation: '',
    disposition: '',
    status: 'open',
    createdBy: opts.userId,
    createdAt: now,
    updatedAt: now,
  })
  await linkEntities({
    orgId: opts.orgId,
    fromKind: opts.sourceKind,
    fromId: opts.sourceId,
    toKind: 'discrepancy',
    toId: id,
    kind: `${opts.sourceKind}_di`,
  })
  const [created] = await db.select().from(discrepancyInvestigations).where(eq(discrepancyInvestigations.id, id))
  return created
}

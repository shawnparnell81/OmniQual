import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Router } from 'express'
import type { ReviewStatus, SupplierStatus } from '../shared/types.ts'
import { requireAuth, type AuthedRequest } from './auth.ts'
import { getDb } from './db/client.ts'
import {
  auditEvents,
  calibrationAssets,
  calibrationEvents,
  folders,
  formRecords,
  managementReviews,
  qualityRecordLinks,
  supplierEvaluations,
  suppliers,
} from './db/schema.ts'
import {
  addDays,
  createFormFromTemplate,
  insertQualityLink,
  linkEntities,
  toCalibrationDetail,
  toCalibrationSummary,
  toReviewDetail,
  toReviewSummary,
  toSupplierDetail,
  toSupplierSummary,
  todayStamp,
} from './qms.ts'

const CAL_RESULTS = ['in_tolerance', 'out_of_tolerance', 'limited'] as const
const SUPPLIER_STATUSES: SupplierStatus[] = ['approved', 'conditional', 'disqualified']
const EVAL_RESULTS = ['pass', 'fail', 'conditional'] as const
const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'completed']

function orgIdOf(req: AuthedRequest) {
  return req.user!.organization.id
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

async function requireFolder(req: AuthedRequest, folderId: string) {
  const db = await getDb()
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.organizationId, orgIdOf(req))))
  return folder ?? null
}

export function registerIsoRoutes(api: Router) {
  api.get('/folders/:id/calibration', requireAuth, async (req: AuthedRequest, res) => {
    const folder = await requireFolder(req, req.params.id as string)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const rows = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.folderId, folder.id), eq(calibrationAssets.organizationId, orgId)))
    res.json({
      assets: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toCalibrationSummary),
    })
  })

  api.post('/calibration', requireAuth, async (req: AuthedRequest, res) => {
    const folderId = String(req.body?.folderId ?? '')
    if (!folderId) {
      res.status(400).json({ error: 'folderId is required.' })
      return
    }
    const folder = await requireFolder(req, folderId)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const existing = await db.select().from(calibrationAssets).where(eq(calibrationAssets.organizationId, orgId))
    const seq = String(existing.length + 1).padStart(4, '0')
    const id = randomUUID()
    const now = new Date()
    await db.insert(calibrationAssets).values({
      id,
      organizationId: orgId,
      folderId: folder.id,
      name: String(req.body?.name ?? '').trim() || 'Gage',
      number: String(req.body?.number ?? '').trim() || `CAL-${seq}`,
      location: String(req.body?.location ?? '').trim(),
      intervalDays: Math.max(1, Number.parseInt(String(req.body?.intervalDays ?? '365'), 10) || 365),
      lastCalibrated: null,
      nextDue: todayStamp(),
      status: 'current',
      createdBy: req.user?.id,
      createdAt: now,
      updatedAt: now,
    })
    const [created] = await db.select().from(calibrationAssets).where(eq(calibrationAssets.id, id))
    const detail = await toCalibrationDetail(created, orgId)
    await writeAudit(orgId, req.user?.id, 'calibration_asset', id, 'create', undefined, detail)
    res.status(201).json(detail)
  })

  api.get('/calibration/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [asset] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, req.params.id as string), eq(calibrationAssets.organizationId, orgId)))
    if (!asset) {
      res.status(404).json({ error: 'Calibration asset not found.' })
      return
    }
    res.json(await toCalibrationDetail(asset, orgId))
  })

  api.patch('/calibration/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [asset] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, req.params.id as string), eq(calibrationAssets.organizationId, orgId)))
    if (!asset) {
      res.status(404).json({ error: 'Calibration asset not found.' })
      return
    }
    let status = asset.status
    if (typeof req.body?.status === 'string') {
      if (req.body.status === 'out_of_service') status = 'out_of_service'
      else if (req.body.status === 'in_service' || req.body.status === 'current') status = 'current'
    }
    const intervalDays = Math.max(
      1,
      typeof req.body?.intervalDays === 'number'
        ? req.body.intervalDays
        : Number.parseInt(String(req.body?.intervalDays ?? asset.intervalDays), 10) || asset.intervalDays,
    )
    const lastCalibrated = asset.lastCalibrated
    const nextDue =
      lastCalibrated && intervalDays !== asset.intervalDays
        ? addDays(String(lastCalibrated).slice(0, 10), intervalDays)
        : asset.nextDue
    await db
      .update(calibrationAssets)
      .set({
        name: typeof req.body?.name === 'string' ? req.body.name.trim() || asset.name : asset.name,
        number: typeof req.body?.number === 'string' ? req.body.number.trim() || asset.number : asset.number,
        location: typeof req.body?.location === 'string' ? req.body.location : asset.location,
        intervalDays,
        nextDue,
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(calibrationAssets.id, asset.id), eq(calibrationAssets.organizationId, orgId)))
    const [updated] = await db.select().from(calibrationAssets).where(eq(calibrationAssets.id, asset.id))
    res.json(await toCalibrationDetail(updated, orgId))
  })

  api.post('/calibration/:id/events', requireAuth, async (req: AuthedRequest, res) => {
    const result = String(req.body?.result ?? '')
    if (!CAL_RESULTS.includes(result as (typeof CAL_RESULTS)[number])) {
      res.status(400).json({ error: 'result must be in_tolerance, out_of_tolerance, or limited.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [asset] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, req.params.id as string), eq(calibrationAssets.organizationId, orgId)))
    if (!asset) {
      res.status(404).json({ error: 'Calibration asset not found.' })
      return
    }
    const eventDate = String(req.body?.date ?? req.body?.eventDate ?? todayStamp()).slice(0, 10)
    const notes = String(req.body?.notes ?? '')
    const eventId = randomUUID()
    await db.insert(calibrationEvents).values({
      id: eventId,
      organizationId: orgId,
      assetId: asset.id,
      eventDate,
      result,
      notes,
      asFound: String(req.body?.asFound ?? ''),
      asLeft: String(req.body?.asLeft ?? ''),
      technician: String(req.body?.technician ?? req.user?.name ?? ''),
      certificate: String(req.body?.certificate ?? ''),
    })
    const nextDue = addDays(eventDate, Math.max(1, asset.intervalDays))
    const nextStatus = result === 'out_of_tolerance' ? 'out_of_service' : result === 'in_tolerance' ? 'current' : asset.status
    await db
      .update(calibrationAssets)
      .set({
        lastCalibrated: eventDate,
        nextDue,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(calibrationAssets.id, asset.id), eq(calibrationAssets.organizationId, orgId)))
    await writeAudit(orgId, req.user?.id, 'calibration_asset', asset.id, 'update', { status: asset.status }, {
      event: { result, eventDate },
      status: nextStatus,
    })
    if (result === 'out_of_tolerance') {
      const existing = await db
        .select()
        .from(qualityRecordLinks)
        .where(
          and(
            eq(qualityRecordLinks.organizationId, orgId),
            eq(qualityRecordLinks.sourceType, 'calibration'),
            eq(qualityRecordLinks.sourceId, asset.id),
            eq(qualityRecordLinks.kind, 'calibration_ncr'),
          ),
        )
      if (existing.length === 0) {
        const created = await createFormFromTemplate({
          orgId,
          userId: req.user?.id,
          slug: 'ncr',
          status: 'open',
          data: {
            description: `${asset.number} (${asset.name}) out of tolerance.`,
            reportedBy: req.user?.name ?? '',
            department: 'Management',
            productOrProcess: asset.name,
            owner: req.user?.name ?? '',
          },
        })
        if (created) {
          await insertQualityLink({
            orgId,
            sourceType: 'calibration',
            sourceId: asset.id,
            recordId: created.created.id,
            kind: 'calibration_ncr',
          })
          await linkEntities({
            orgId,
            fromKind: 'calibration',
            fromId: asset.id,
            toKind: 'ncr',
            toId: created.created.id,
            kind: 'calibration_ncr',
          })
        }
      }
    }
    const [updated] = await db.select().from(calibrationAssets).where(eq(calibrationAssets.id, asset.id))
    res.status(201).json(await toCalibrationDetail(updated, orgId))
  })

  api.post('/calibration/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [asset] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.id, req.params.id as string), eq(calibrationAssets.organizationId, orgId)))
    if (!asset) {
      res.status(404).json({ error: 'Calibration asset not found.' })
      return
    }
    const existingNcr = await db
      .select()
      .from(qualityRecordLinks)
      .where(
        and(
          eq(qualityRecordLinks.organizationId, orgId),
          eq(qualityRecordLinks.sourceType, 'calibration'),
          eq(qualityRecordLinks.sourceId, asset.id),
          eq(qualityRecordLinks.kind, 'calibration_ncr'),
        ),
      )
    if (existingNcr[0]) {
      const [record] = await db
        .select()
        .from(formRecords)
        .where(and(eq(formRecords.id, existingNcr[0].recordId), eq(formRecords.organizationId, orgId)))
      if (record) {
        res.json({
          id: record.id,
          folderId: record.folderId,
          title: record.title,
          status: record.status,
          templateId: record.templateId,
        })
        return
      }
    }
    const created = await createFormFromTemplate({
      orgId,
      userId: req.user?.id,
      slug: 'ncr',
      status: 'open',
      data: {
        description: `${asset.number} (${asset.name}) out of tolerance.${asset.location ? ` Location: ${asset.location}.` : ''}`,
        reportedBy: req.user?.name ?? '',
        department: 'Management',
        productOrProcess: asset.name,
        owner: req.user?.name ?? '',
      },
    })
    if (!created) {
      res.status(404).json({ error: 'NCR template not found for this tenant.' })
      return
    }
    await insertQualityLink({
      orgId,
      sourceType: 'calibration',
      sourceId: asset.id,
      recordId: created.created.id,
      kind: 'calibration_ncr',
    })
    await linkEntities({
      orgId,
      fromKind: 'calibration',
      fromId: asset.id,
      toKind: 'ncr',
      toId: created.created.id,
      kind: 'calibration_ncr',
    })
    await writeAudit(orgId, req.user?.id, 'form_record', created.created.id, 'create', undefined, {
      fromCalibration: asset.id,
    })
    res.status(201).json({
      id: created.created.id,
      folderId: created.created.folderId,
      title: created.created.title,
      status: created.created.status,
      templateId: created.created.templateId,
    })
  })

  api.get('/folders/:id/suppliers', requireAuth, async (req: AuthedRequest, res) => {
    const folder = await requireFolder(req, req.params.id as string)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const rows = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.folderId, folder.id), eq(suppliers.organizationId, orgId)))
    res.json({
      suppliers: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toSupplierSummary),
    })
  })

  api.post('/suppliers', requireAuth, async (req: AuthedRequest, res) => {
    const folderId = String(req.body?.folderId ?? '')
    if (!folderId) {
      res.status(400).json({ error: 'folderId is required.' })
      return
    }
    const folder = await requireFolder(req, folderId)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const existing = await db.select().from(suppliers).where(eq(suppliers.organizationId, orgId))
    const seq = String(existing.length + 1).padStart(4, '0')
    const id = randomUUID()
    const now = new Date()
    await db.insert(suppliers).values({
      id,
      organizationId: orgId,
      folderId: folder.id,
      name: String(req.body?.name ?? '').trim() || 'Supplier',
      number: String(req.body?.number ?? '').trim() || `SUP-${seq}`,
      status: 'approved',
      lastEvaluationDate: null,
      notes: String(req.body?.notes ?? ''),
      createdBy: req.user?.id,
      createdAt: now,
      updatedAt: now,
    })
    const [created] = await db.select().from(suppliers).where(eq(suppliers.id, id))
    const detail = await toSupplierDetail(created, orgId)
    await writeAudit(orgId, req.user?.id, 'supplier', id, 'create', undefined, detail)
    res.status(201).json(detail)
  })

  api.get('/suppliers/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, req.params.id as string), eq(suppliers.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Supplier not found.' })
      return
    }
    res.json(await toSupplierDetail(row, orgId))
  })

  api.patch('/suppliers/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, req.params.id as string), eq(suppliers.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Supplier not found.' })
      return
    }
    let status = row.status
    if (typeof req.body?.status === 'string') {
      if (!SUPPLIER_STATUSES.includes(req.body.status as SupplierStatus)) {
        res.status(400).json({ error: 'Status must be approved, conditional, or disqualified.' })
        return
      }
      status = req.body.status
    }
    await db
      .update(suppliers)
      .set({
        name: typeof req.body?.name === 'string' ? req.body.name.trim() || row.name : row.name,
        number: typeof req.body?.number === 'string' ? req.body.number.trim() || row.number : row.number,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : row.notes,
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, row.id), eq(suppliers.organizationId, orgId)))
    const [updated] = await db.select().from(suppliers).where(eq(suppliers.id, row.id))
    if (status !== row.status) {
      await writeAudit(orgId, req.user?.id, 'supplier', row.id, 'status', { status: row.status }, { status })
    }
    res.json(await toSupplierDetail(updated, orgId))
  })

  api.post('/suppliers/:id/evaluations', requireAuth, async (req: AuthedRequest, res) => {
    const result = String(req.body?.result ?? '')
    if (!EVAL_RESULTS.includes(result as (typeof EVAL_RESULTS)[number])) {
      res.status(400).json({ error: 'result must be pass, fail, or conditional.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, req.params.id as string), eq(suppliers.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Supplier not found.' })
      return
    }
    const evalDate = String(req.body?.date ?? req.body?.evalDate ?? todayStamp()).slice(0, 10)
    const scoreRaw = req.body?.score
    const score =
      scoreRaw === '' || scoreRaw == null ? null : Number.parseInt(String(scoreRaw), 10)
    await db.insert(supplierEvaluations).values({
      id: randomUUID(),
      organizationId: orgId,
      supplierId: row.id,
      evalDate,
      result,
      score: Number.isFinite(score as number) ? (score as number) : null,
      comments: String(req.body?.comments ?? ''),
    })
    const nextStatus =
      result === 'pass' ? 'approved' : result === 'fail' ? 'conditional' : 'conditional'
    await db
      .update(suppliers)
      .set({
        lastEvaluationDate: evalDate,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, row.id), eq(suppliers.organizationId, orgId)))
    await writeAudit(orgId, req.user?.id, 'supplier', row.id, 'update', { status: row.status }, {
      evaluation: { result, evalDate },
      status: nextStatus,
    })
    const [updated] = await db.select().from(suppliers).where(eq(suppliers.id, row.id))
    res.status(201).json(await toSupplierDetail(updated, orgId))
  })

  api.post('/suppliers/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
    const type = String(req.body?.type ?? '')
    if (type !== 'ncr' && type !== 'capa') {
      res.status(400).json({ error: 'type must be ncr or capa.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, req.params.id as string), eq(suppliers.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Supplier not found.' })
      return
    }
    const finding = row.notes.trim() || `${row.name} evaluation failed`
    const created = await createFormFromTemplate({
      orgId,
      userId: req.user?.id,
      slug: type,
      status: 'open',
      data:
        type === 'ncr'
          ? {
              description: finding,
              reportedBy: req.user?.name ?? '',
              department: 'Purchasing',
              productOrProcess: row.name,
              owner: req.user?.name ?? '',
            }
          : {
              source: 'Supplier issue',
              problemStatement: finding,
              initiatedBy: req.user?.name ?? '',
              owner: req.user?.name ?? '',
              containment: '',
              proposedAction: '',
            },
    })
    if (!created) {
      res.status(404).json({ error: `${type.toUpperCase()} template not found for this tenant.` })
      return
    }
    await insertQualityLink({
      orgId,
      sourceType: 'supplier',
      sourceId: row.id,
      recordId: created.created.id,
      kind: type === 'ncr' ? 'supplier_ncr' : 'supplier_capa',
    })
    await writeAudit(orgId, req.user?.id, 'form_record', created.created.id, 'create', undefined, {
      fromSupplier: row.id,
    })
    res.status(201).json({
      id: created.created.id,
      folderId: created.created.folderId,
      title: created.created.title,
      status: created.created.status,
      templateId: created.created.templateId,
    })
  })

  api.get('/folders/:id/reviews', requireAuth, async (req: AuthedRequest, res) => {
    const folder = await requireFolder(req, req.params.id as string)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const rows = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.folderId, folder.id), eq(managementReviews.organizationId, orgId)))
    res.json({
      reviews: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toReviewSummary),
    })
  })

  api.post('/reviews', requireAuth, async (req: AuthedRequest, res) => {
    const folderId = String(req.body?.folderId ?? '')
    if (!folderId) {
      res.status(400).json({ error: 'folderId is required.' })
      return
    }
    const folder = await requireFolder(req, folderId)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const existing = await db.select().from(managementReviews).where(eq(managementReviews.organizationId, orgId))
    const seq = String(existing.length + 1).padStart(4, '0')
    const id = randomUUID()
    const now = new Date()
    await db.insert(managementReviews).values({
      id,
      organizationId: orgId,
      folderId: folder.id,
      number: String(req.body?.number ?? '').trim() || `MR-${seq}`,
      meetingDate: todayStamp(),
      attendees: String(req.body?.attendees ?? ''),
      inputsSummary: String(req.body?.inputsSummary ?? ''),
      outputsActions: String(req.body?.outputsActions ?? ''),
      status: 'draft',
      createdBy: req.user?.id,
      createdAt: now,
      updatedAt: now,
    })
    const [created] = await db.select().from(managementReviews).where(eq(managementReviews.id, id))
    const detail = await toReviewDetail(created, orgId)
    await writeAudit(orgId, req.user?.id, 'management_review', id, 'create', undefined, detail)
    res.status(201).json(detail)
  })

  api.get('/reviews/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.id, req.params.id as string), eq(managementReviews.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Management review not found.' })
      return
    }
    res.json(await toReviewDetail(row, orgId))
  })

  api.patch('/reviews/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.id, req.params.id as string), eq(managementReviews.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Management review not found.' })
      return
    }
    await db
      .update(managementReviews)
      .set({
        number: typeof req.body?.number === 'string' ? req.body.number.trim() || row.number : row.number,
        meetingDate:
          typeof req.body?.meetingDate === 'string' ? req.body.meetingDate || null : row.meetingDate,
        attendees: typeof req.body?.attendees === 'string' ? req.body.attendees : row.attendees,
        inputsSummary: typeof req.body?.inputsSummary === 'string' ? req.body.inputsSummary : row.inputsSummary,
        outputsActions:
          typeof req.body?.outputsActions === 'string' ? req.body.outputsActions : row.outputsActions,
        updatedAt: new Date(),
      })
      .where(and(eq(managementReviews.id, row.id), eq(managementReviews.organizationId, orgId)))
    const [updated] = await db.select().from(managementReviews).where(eq(managementReviews.id, row.id))
    res.json(await toReviewDetail(updated, orgId))
  })

  api.post('/reviews/:id/status', requireAuth, async (req: AuthedRequest, res) => {
    const nextStatus = String(req.body?.status ?? '') as ReviewStatus
    if (!REVIEW_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: 'Status must be draft or completed.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.id, req.params.id as string), eq(managementReviews.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Management review not found.' })
      return
    }
    await db
      .update(managementReviews)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(managementReviews.id, row.id), eq(managementReviews.organizationId, orgId)))
    const [updated] = await db.select().from(managementReviews).where(eq(managementReviews.id, row.id))
    await writeAudit(
      orgId,
      req.user?.id,
      'management_review',
      row.id,
      'status',
      { status: row.status },
      { status: nextStatus },
    )
    res.json(await toReviewDetail(updated, orgId))
  })

  api.post('/reviews/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(managementReviews)
      .where(and(eq(managementReviews.id, req.params.id as string), eq(managementReviews.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Management review not found.' })
      return
    }
    const created = await createFormFromTemplate({
      orgId,
      userId: req.user?.id,
      slug: 'capa',
      status: 'open',
      data: {
        source: 'Trend / management review',
        problemStatement: row.outputsActions.trim() || `${row.number} management review action`,
        initiatedBy: req.user?.name ?? '',
        owner: req.user?.name ?? '',
        containment: '',
        proposedAction: row.outputsActions,
      },
    })
    if (!created) {
      res.status(404).json({ error: 'CAPA template not found for this tenant.' })
      return
    }
    await insertQualityLink({
      orgId,
      sourceType: 'management_review',
      sourceId: row.id,
      recordId: created.created.id,
      kind: 'review_capa',
    })
    await writeAudit(orgId, req.user?.id, 'form_record', created.created.id, 'create', undefined, {
      fromReview: row.id,
    })
    res.status(201).json({
      id: created.created.id,
      folderId: created.created.folderId,
      title: created.created.title,
      status: created.created.status,
      templateId: created.created.templateId,
    })
  })
}

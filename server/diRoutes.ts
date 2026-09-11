import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Router } from 'express'
import { requireAuth, type AuthedRequest } from './auth.ts'
import { getDb } from './db/client.ts'
import {
  auditEvents,
  auditFindings,
  discrepancyInvestigations,
  folders,
  inspections,
  internalAudits,
} from './db/schema.ts'
import {
  createFormFromTemplate,
  ensureDiscrepancyForFinding,
  ensureDiscrepancyForSource,
  insertQualityLink,
  linkEntities,
  toDiscrepancyDetail,
  toDiscrepancySummary,
  toFinding,
  toInspectionDetail,
  toInspectionSummary,
  todayStamp,
} from './qms.ts'

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

const SEVERITIES = ['observation', 'minor', 'major'] as const

export function registerDiRoutes(api: Router) {
  api.post('/audits/:id/findings', requireAuth, async (req: AuthedRequest, res) => {
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
    const severity = String(req.body?.severity ?? 'observation')
    if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
      res.status(400).json({ error: 'severity must be observation, minor, or major.' })
      return
    }
    const id = randomUUID()
    const now = new Date()
    await db.insert(auditFindings).values({
      id,
      organizationId: orgId,
      auditId: audit.id,
      severity,
      clause: String(req.body?.clause ?? ''),
      description: String(req.body?.description ?? ''),
      evidence: String(req.body?.evidence ?? ''),
      discrepancyId: null,
      createdAt: now,
      updatedAt: now,
    })
    await linkEntities({
      orgId,
      fromKind: 'audit',
      fromId: audit.id,
      toKind: 'finding',
      toId: id,
      kind: 'audit_finding',
    })
    const [finding] = await db.select().from(auditFindings).where(eq(auditFindings.id, id))
    let discrepancy = null
    if (severity === 'major') {
      discrepancy = await ensureDiscrepancyForFinding({ orgId, userId: req.user?.id, finding })
      await writeAudit(orgId, req.user?.id, 'discrepancy', discrepancy?.id ?? id, 'create', undefined, {
        fromFinding: id,
      })
    }
    await writeAudit(orgId, req.user?.id, 'audit_finding', id, 'create', undefined, toFinding(finding))
    res.status(201).json({
      finding: toFinding(finding),
      discrepancy: discrepancy ? await toDiscrepancyDetail(discrepancy, orgId) : null,
    })
  })

  api.post('/findings/:id/discrepancy', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [finding] = await db
      .select()
      .from(auditFindings)
      .where(and(eq(auditFindings.id, req.params.id as string), eq(auditFindings.organizationId, orgId)))
    if (!finding) {
      res.status(404).json({ error: 'Finding not found.' })
      return
    }
    if (finding.severity !== 'major') {
      res.status(400).json({ error: 'A Discrepancy Investigation is only opened for MAJOR findings.' })
      return
    }
    const discrepancy = await ensureDiscrepancyForFinding({ orgId, userId: req.user?.id, finding })
    if (!discrepancy) {
      res.status(500).json({ error: 'Could not create discrepancy investigation.' })
      return
    }
    res.status(finding.discrepancyId ? 200 : 201).json(await toDiscrepancyDetail(discrepancy, orgId))
  })

  api.get('/folders/:id/discrepancies', requireAuth, async (req: AuthedRequest, res) => {
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
    const rows =
      folder.slug === 'discrepancy'
        ? await db
            .select()
            .from(discrepancyInvestigations)
            .where(eq(discrepancyInvestigations.organizationId, orgId))
        : await db
            .select()
            .from(discrepancyInvestigations)
            .where(
              and(eq(discrepancyInvestigations.organizationId, orgId), eq(discrepancyInvestigations.folderId, folder.id)),
            )
    res.json({
      discrepancies: rows
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(toDiscrepancySummary),
    })
  })

  api.get('/discrepancies/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(
        and(eq(discrepancyInvestigations.id, req.params.id as string), eq(discrepancyInvestigations.organizationId, orgId)),
      )
    if (!row) {
      res.status(404).json({ error: 'Discrepancy investigation not found.' })
      return
    }
    res.json(await toDiscrepancyDetail(row, orgId))
  })

  api.patch('/discrepancies/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(
        and(eq(discrepancyInvestigations.id, req.params.id as string), eq(discrepancyInvestigations.organizationId, orgId)),
      )
    if (!row) {
      res.status(404).json({ error: 'Discrepancy investigation not found.' })
      return
    }
    await db
      .update(discrepancyInvestigations)
      .set({
        identification: typeof req.body?.identification === 'string' ? req.body.identification : row.identification,
        containment: typeof req.body?.containment === 'string' ? req.body.containment : row.containment,
        investigation: typeof req.body?.investigation === 'string' ? req.body.investigation : row.investigation,
        disposition: typeof req.body?.disposition === 'string' ? req.body.disposition : row.disposition,
        status: typeof req.body?.status === 'string' && ['open', 'closed'].includes(req.body.status) ? req.body.status : row.status,
        updatedAt: new Date(),
      })
      .where(and(eq(discrepancyInvestigations.id, row.id), eq(discrepancyInvestigations.organizationId, orgId)))
    const [updated] = await db.select().from(discrepancyInvestigations).where(eq(discrepancyInvestigations.id, row.id))
    res.json(await toDiscrepancyDetail(updated, orgId))
  })

  api.post('/discrepancies/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
    const type = String(req.body?.type ?? '')
    if (type !== 'ncr' && type !== 'capa') {
      res.status(400).json({ error: 'type must be ncr or capa.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(discrepancyInvestigations)
      .where(
        and(eq(discrepancyInvestigations.id, req.params.id as string), eq(discrepancyInvestigations.organizationId, orgId)),
      )
    if (!row) {
      res.status(404).json({ error: 'Discrepancy investigation not found.' })
      return
    }
    const created = await createFormFromTemplate({
      orgId,
      userId: req.user?.id,
      slug: type,
      status: 'open',
      data:
        type === 'ncr'
          ? {
              description: row.identification,
              reportedBy: req.user?.name ?? '',
              department: 'Quality',
              productOrProcess: 'Internal audit',
              owner: req.user?.name ?? '',
              immediateAction: row.containment,
            }
          : {
              source: 'Internal audit',
              problemStatement: row.identification,
              initiatedBy: req.user?.name ?? '',
              owner: req.user?.name ?? '',
              containment: row.containment,
              proposedAction: row.disposition,
            },
    })
    if (!created) {
      res.status(404).json({ error: `${type.toUpperCase()} template not found for this tenant.` })
      return
    }
    await insertQualityLink({
      orgId,
      sourceType: 'discrepancy',
      sourceId: row.id,
      recordId: created.created.id,
      kind: type === 'ncr' ? 'di_ncr' : 'di_capa',
    })
    await linkEntities({
      orgId,
      fromKind: 'discrepancy',
      fromId: row.id,
      toKind: type,
      toId: created.created.id,
      kind: type === 'ncr' ? 'di_ncr' : 'di_capa',
    })
    await writeAudit(orgId, req.user?.id, 'form_record', created.created.id, 'create', undefined, {
      fromDiscrepancy: row.id,
    })
    res.status(201).json({
      id: created.created.id,
      folderId: created.created.folderId,
      title: created.created.title,
      status: created.created.status,
      templateId: created.created.templateId,
    })
  })

  api.get('/folders/:id/inspections', requireAuth, async (req: AuthedRequest, res) => {
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
      .from(inspections)
      .where(and(eq(inspections.organizationId, orgId), eq(inspections.folderId, folder.id)))
    res.json({
      inspections: rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toInspectionSummary),
    })
  })

  api.post('/inspections', requireAuth, async (req: AuthedRequest, res) => {
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
    const existing = await db.select().from(inspections).where(eq(inspections.organizationId, orgId))
    const id = randomUUID()
    const now = new Date()
    await db.insert(inspections).values({
      id,
      organizationId: orgId,
      folderId: folder.id,
      number: String(req.body?.number ?? '').trim() || `INSP-${String(existing.length + 1).padStart(4, '0')}`,
      title: String(req.body?.title ?? '').trim() || 'Inspection',
      area: String(req.body?.area ?? ''),
      inspector: String(req.body?.inspector ?? req.user?.name ?? ''),
      inspectedAt: todayStamp(),
      result: 'pending',
      notes: '',
      status: 'open',
      createdBy: req.user?.id,
      createdAt: now,
      updatedAt: now,
    })
    const [created] = await db.select().from(inspections).where(eq(inspections.id, id))
    await writeAudit(orgId, req.user?.id, 'inspection', id, 'create', undefined, toInspectionSummary(created))
    res.status(201).json(await toInspectionDetail(created, orgId))
  })

  api.get('/inspections/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(inspections)
      .where(and(eq(inspections.id, req.params.id as string), eq(inspections.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Inspection not found.' })
      return
    }
    res.json(await toInspectionDetail(row, orgId))
  })

  api.patch('/inspections/:id', requireAuth, async (req: AuthedRequest, res) => {
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(inspections)
      .where(and(eq(inspections.id, req.params.id as string), eq(inspections.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Inspection not found.' })
      return
    }
    await db
      .update(inspections)
      .set({
        title: typeof req.body?.title === 'string' ? req.body.title.trim() || row.title : row.title,
        area: typeof req.body?.area === 'string' ? req.body.area : row.area,
        inspector: typeof req.body?.inspector === 'string' ? req.body.inspector : row.inspector,
        inspectedAt: typeof req.body?.inspectedAt === 'string' ? req.body.inspectedAt || null : row.inspectedAt,
        result: typeof req.body?.result === 'string' ? req.body.result : row.result,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : row.notes,
        status: typeof req.body?.status === 'string' ? req.body.status : row.status,
        updatedAt: new Date(),
      })
      .where(and(eq(inspections.id, row.id), eq(inspections.organizationId, orgId)))
    const [updated] = await db.select().from(inspections).where(eq(inspections.id, row.id))
    if (updated.result === 'fail') {
      await ensureDiscrepancyForSource({
        orgId,
        userId: req.user?.id,
        sourceKind: 'inspection',
        sourceId: updated.id,
        identification: `Inspection ${updated.number} failed — ${updated.title}${updated.area ? ` (${updated.area})` : ''}`,
        containment: updated.notes,
      })
    }
    res.json(await toInspectionDetail(updated, orgId))
  })

  api.post('/inspections/:id/linked-record', requireAuth, async (req: AuthedRequest, res) => {
    const type = String(req.body?.type ?? 'ncr')
    if (type !== 'ncr' && type !== 'capa' && type !== 'discrepancy') {
      res.status(400).json({ error: 'type must be ncr, capa, or discrepancy.' })
      return
    }
    const db = await getDb()
    const orgId = orgIdOf(req)
    const [row] = await db
      .select()
      .from(inspections)
      .where(and(eq(inspections.id, req.params.id as string), eq(inspections.organizationId, orgId)))
    if (!row) {
      res.status(404).json({ error: 'Inspection not found.' })
      return
    }
    if (type === 'discrepancy') {
      const discrepancy = await ensureDiscrepancyForSource({
        orgId,
        userId: req.user?.id,
        sourceKind: 'inspection',
        sourceId: row.id,
        identification: `Inspection ${row.number} — ${row.title}${row.area ? ` (${row.area})` : ''}`,
        containment: row.notes,
      })
      if (!discrepancy) {
        res.status(500).json({ error: 'Could not create discrepancy investigation.' })
        return
      }
      const detail = await toDiscrepancyDetail(discrepancy, orgId)
      res.status(201).json({ ...detail, title: detail.number })
      return
    }
    const created = await createFormFromTemplate({
      orgId,
      userId: req.user?.id,
      slug: type,
      status: 'open',
      data:
        type === 'ncr'
          ? {
              description: row.notes || row.title,
              reportedBy: row.inspector,
              department: 'Production',
              productOrProcess: row.area || row.title,
              owner: row.inspector,
            }
          : {
              source: 'Other',
              problemStatement: row.notes || row.title,
              initiatedBy: row.inspector,
              owner: row.inspector,
            },
    })
    if (!created) {
      res.status(404).json({ error: `${type.toUpperCase()} template not found for this tenant.` })
      return
    }
    await insertQualityLink({
      orgId,
      sourceType: 'inspection',
      sourceId: row.id,
      recordId: created.created.id,
      kind: type === 'ncr' ? 'inspection_ncr' : 'inspection_capa',
    })
    await linkEntities({
      orgId,
      fromKind: 'inspection',
      fromId: row.id,
      toKind: type,
      toId: created.created.id,
      kind: type === 'ncr' ? 'inspection_ncr' : 'inspection_capa',
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

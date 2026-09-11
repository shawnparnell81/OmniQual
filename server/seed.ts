import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { and, count, eq } from 'drizzle-orm'
import type { FormSchema } from '../shared/types.ts'
import { applySqlMigration, getDb, type AppDb } from './db/client.ts'
import { auditEvents, calibrationAssets, folders, formTemplates, organizations, users } from './db/schema.ts'
import { addDays, todayStamp } from './qms.ts'
import { buildTemplatePdf, pdfToBase64 } from './pdf/templates.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

type NavConfig = {
  departments: Array<{
    id: string
    label: string
    children?: Array<{ id: string; label: string }>
  }>
}

type FormConfig = {
  id: string
  folderId: string
  title: string
  description: string
  schema: FormSchema
}

export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'org'
}

export async function seedQmsForOrganization(db: AppDb, organizationId: string, userId?: string) {
  const nav = JSON.parse(
    readFileSync(resolve(__dirname, '../config/nav.json'), 'utf8'),
  ) as NavConfig

  const slugToId = new Map<string, string>()
  let order = 0
  for (const dept of nav.departments) {
    const id = randomUUID()
    slugToId.set(dept.id, id)
    await db.insert(folders).values({
      id,
      organizationId,
      parentId: null,
      slug: dept.id,
      label: dept.label,
      sortOrder: order++,
    })
    let childOrder = 0
    for (const child of dept.children ?? []) {
      const childId = randomUUID()
      slugToId.set(child.id, childId)
      await db.insert(folders).values({
        id: childId,
        organizationId,
        parentId: id,
        slug: child.id,
        label: child.label,
        sortOrder: childOrder++,
      })
    }
  }

  const formFiles = ['ncr.json', 'capa.json', 'training-attendance.json']
  for (const file of formFiles) {
    const config = JSON.parse(
      readFileSync(resolve(__dirname, '../config/forms', file), 'utf8'),
    ) as FormConfig
    const folderId = slugToId.get(config.folderId)
    if (!folderId) continue
    const pdf = await buildTemplatePdf(config.schema)
    await db.insert(formTemplates).values({
      id: randomUUID(),
      organizationId,
      folderId,
      slug: config.id,
      title: config.title,
      description: config.description,
      schemaJson: config.schema,
      pdfBytes: pdfToBase64(pdf),
      version: 1,
      status: 'effective',
    })
  }

  await db.insert(auditEvents).values({
    id: randomUUID(),
    organizationId,
    userId: userId ?? null,
    entityType: 'organization',
    entityId: organizationId,
    action: 'seed',
    afterJson: { note: 'ISO 9001 Phase 1 tenant seed complete' },
  })
}

export async function seedIfEmpty() {
  const db = await getDb()
  await applySqlMigration()

  const [{ value: orgCount }] = await db.select({ value: count() }).from(organizations)
  if (orgCount === 0) {
    const organizationId = randomUUID()
    const userId = randomUUID()
    const passwordHash = await bcrypt.hash('demo', 10)

    await db.insert(organizations).values({
      id: organizationId,
      name: 'Acme Manufacturing',
      slug: 'acme-manufacturing',
    })
    await db.insert(users).values({
      id: userId,
      organizationId,
      email: 'demo@omniqual.local',
      name: 'Demo Quality Manager',
      passwordHash,
      department: 'Quality',
    })
    await seedQmsForOrganization(db, organizationId, userId)
    console.log('[omniqual] seeded tenant Acme Manufacturing / demo@omniqual.local / demo')
  }

  await ensureTenantExtras()
}

async function ensureTenantExtras() {
  const db = await getDb()
  const nav = JSON.parse(readFileSync(resolve(__dirname, '../config/nav.json'), 'utf8')) as NavConfig
  const orgs = await db.select().from(organizations)
  for (const org of orgs) {
    await ensureNavFolders(db, org.id, nav)
    await ensureCalibrationDemos(db, org.id)
  }
}

async function ensureNavFolders(db: AppDb, organizationId: string, nav: NavConfig) {
  const existing = await db.select().from(folders).where(eq(folders.organizationId, organizationId))
  const bySlug = new Map(existing.map((row) => [row.slug, row]))
  let order = existing.length
  for (const dept of nav.departments) {
    let parent = bySlug.get(dept.id)
    if (!parent) {
      const id = randomUUID()
      await db.insert(folders).values({
        id,
        organizationId,
        parentId: null,
        slug: dept.id,
        label: dept.label,
        sortOrder: order++,
      })
      parent = { id, organizationId, parentId: null, slug: dept.id, label: dept.label, sortOrder: order }
      bySlug.set(dept.id, parent)
    }
    let childOrder = 0
    for (const child of dept.children ?? []) {
      if (bySlug.has(child.id)) continue
      const childId = randomUUID()
      await db.insert(folders).values({
        id: childId,
        organizationId,
        parentId: parent!.id,
        slug: child.id,
        label: child.label,
        sortOrder: childOrder++,
      })
      bySlug.set(child.id, {
        id: childId,
        organizationId,
        parentId: parent!.id,
        slug: child.id,
        label: child.label,
        sortOrder: childOrder,
      })
    }
  }
}

async function ensureCalibrationDemos(db: AppDb, organizationId: string) {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.organizationId, organizationId), eq(folders.slug, 'calibration')))
  if (!folder) return
  const today = todayStamp()
  const demos = [
    { number: 'CAL-DEMO-CURRENT', name: 'Surface plate (demo · current)', nextDue: addDays(today, 90), last: addDays(today, 90 - 365) },
    { number: 'CAL-DEMO-SOON', name: 'Digital caliper (demo · due soon)', nextDue: addDays(today, 14), last: addDays(today, 14 - 365) },
    { number: 'CAL-DEMO-OVERDUE', name: 'Micrometer 0–1" (demo · overdue)', nextDue: addDays(today, -12), last: addDays(today, -12 - 365) },
  ]
  for (const demo of demos) {
    const [hit] = await db
      .select()
      .from(calibrationAssets)
      .where(and(eq(calibrationAssets.organizationId, organizationId), eq(calibrationAssets.number, demo.number)))
    if (hit) continue
    const now = new Date()
    await db.insert(calibrationAssets).values({
      id: randomUUID(),
      organizationId,
      folderId: folder.id,
      name: demo.name,
      number: demo.number,
      location: 'Quality lab',
      intervalDays: 365,
      lastCalibrated: demo.last,
      nextDue: demo.nextDue,
      status: 'current',
      createdAt: now,
      updatedAt: now,
    })
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  await seedIfEmpty()
}

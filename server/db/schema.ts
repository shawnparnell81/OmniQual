import { date, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { FormDataMap, FormSchema } from '../../shared/types.ts'

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  department: text('department').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const folders = pgTable(
  'folders',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('folders_org_slug').on(table.organizationId, table.slug)],
)

export const formTemplates = pgTable(
  'form_templates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    schemaJson: jsonb('schema_json').$type<FormSchema>().notNull(),
    pdfBytes: text('pdf_bytes').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('effective'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('templates_org_slug').on(table.organizationId, table.slug)],
)

export const formRecords = pgTable('form_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  templateId: text('template_id')
    .notNull()
    .references(() => formTemplates.id),
  folderId: text('folder_id')
    .notNull()
    .references(() => folders.id),
  title: text('title').notNull(),
  data: jsonb('data').$type<FormDataMap>().notNull(),
  status: text('status').notNull().default('draft'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const controlledDocuments = pgTable(
  'controlled_documents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    title: text('title').notNull(),
    number: text('number').notNull(),
    revision: text('revision').notNull(),
    status: text('status').notNull().default('draft'),
    effectiveDate: date('effective_date'),
    body: text('body').notNull().default(''),
    trainingRoles: text('training_roles').notNull().default(''),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('controlled_docs_org_number_rev').on(table.organizationId, table.number, table.revision)],
)

export const recordLinks = pgTable(
  'record_links',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fromRecordId: text('from_record_id')
      .notNull()
      .references(() => formRecords.id, { onDelete: 'cascade' }),
    toRecordId: text('to_record_id')
      .notNull()
      .references(() => formRecords.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('record_links_unique').on(
      table.organizationId,
      table.fromRecordId,
      table.toRecordId,
      table.kind,
    ),
  ],
)

export const internalAudits = pgTable(
  'internal_audits',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    title: text('title').notNull(),
    number: text('number').notNull(),
    scope: text('scope').notNull().default(''),
    plannedDate: date('planned_date'),
    auditor: text('auditor').notNull().default(''),
    status: text('status').notNull().default('planned'),
    findings: text('findings').notNull().default(''),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('internal_audits_org_number').on(table.organizationId, table.number)],
)

export const auditRecordLinks = pgTable(
  'audit_record_links',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    auditId: text('audit_id')
      .notNull()
      .references(() => internalAudits.id, { onDelete: 'cascade' }),
    recordId: text('record_id')
      .notNull()
      .references(() => formRecords.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_record_links_unique').on(
      table.organizationId,
      table.auditId,
      table.recordId,
      table.kind,
    ),
  ],
)

export const trainingAssignments = pgTable(
  'training_assignments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => controlledDocuments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentNumber: text('document_number').notNull(),
    revision: text('revision').notNull(),
    documentTitle: text('document_title').notNull(),
    status: text('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('training_org_doc_user').on(table.organizationId, table.documentId, table.userId)],
)

export const capaInvestigations = pgTable(
  'capa_investigations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    recordId: text('record_id')
      .notNull()
      .references(() => formRecords.id, { onDelete: 'cascade' }),
    rootCause: text('root_cause').notNull().default(''),
    rcaMethod: text('rca_method').notNull().default('5-why'),
    effectivenessPlan: text('effectiveness_plan').notNull().default(''),
    effectivenessResult: text('effectiveness_result').notNull().default(''),
    verifiedDate: date('verified_date'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('capa_investigations_record').on(table.organizationId, table.recordId)],
)

export const capaActions = pgTable('capa_actions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  recordId: text('record_id')
    .notNull()
    .references(() => formRecords.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  description: text('description').notNull().default(''),
  owner: text('owner').notNull().default(''),
  dueDate: date('due_date'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const calibrationAssets = pgTable(
  'calibration_assets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    name: text('name').notNull(),
    number: text('number').notNull(),
    location: text('location').notNull().default(''),
    intervalDays: integer('interval_days').notNull().default(365),
    lastCalibrated: date('last_calibrated'),
    nextDue: date('next_due'),
    status: text('status').notNull().default('due'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('calibration_assets_org_number').on(table.organizationId, table.number)],
)

export const calibrationEvents = pgTable('calibration_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  assetId: text('asset_id')
    .notNull()
    .references(() => calibrationAssets.id, { onDelete: 'cascade' }),
  eventDate: date('event_date').notNull(),
  result: text('result').notNull(),
  notes: text('notes').notNull().default(''),
  asFound: text('as_found').notNull().default(''),
  asLeft: text('as_left').notNull().default(''),
  technician: text('technician').notNull().default(''),
  certificate: text('certificate').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const suppliers = pgTable(
  'suppliers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    name: text('name').notNull(),
    number: text('number').notNull(),
    status: text('status').notNull().default('approved'),
    lastEvaluationDate: date('last_evaluation_date'),
    notes: text('notes').notNull().default(''),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('suppliers_org_number').on(table.organizationId, table.number)],
)

export const supplierEvaluations = pgTable('supplier_evaluations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'cascade' }),
  evalDate: date('eval_date').notNull(),
  result: text('result').notNull(),
  score: integer('score'),
  comments: text('comments').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const managementReviews = pgTable(
  'management_reviews',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    number: text('number').notNull(),
    meetingDate: date('meeting_date'),
    attendees: text('attendees').notNull().default(''),
    inputsSummary: text('inputs_summary').notNull().default(''),
    outputsActions: text('outputs_actions').notNull().default(''),
    status: text('status').notNull().default('draft'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('management_reviews_org_number').on(table.organizationId, table.number)],
)

export const qualityRecordLinks = pgTable(
  'quality_record_links',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    recordId: text('record_id')
      .notNull()
      .references(() => formRecords.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quality_record_links_unique').on(
      table.organizationId,
      table.sourceType,
      table.sourceId,
      table.recordId,
      table.kind,
    ),
  ],
)

export const auditFindings = pgTable('audit_findings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  auditId: text('audit_id')
    .notNull()
    .references(() => internalAudits.id, { onDelete: 'cascade' }),
  severity: text('severity').notNull(),
  clause: text('clause').notNull().default(''),
  description: text('description').notNull().default(''),
  evidence: text('evidence').notNull().default(''),
  discrepancyId: text('discrepancy_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const discrepancyInvestigations = pgTable(
  'discrepancy_investigations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    findingId: text('finding_id').references(() => auditFindings.id),
    number: text('number').notNull(),
    identification: text('identification').notNull().default(''),
    containment: text('containment').notNull().default(''),
    investigation: text('investigation').notNull().default(''),
    disposition: text('disposition').notNull().default(''),
    status: text('status').notNull().default('open'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discrepancy_org_finding').on(table.organizationId, table.findingId),
    uniqueIndex('discrepancy_org_number').on(table.organizationId, table.number),
  ],
)

export const entityLinks = pgTable(
  'entity_links',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fromKind: text('from_kind').notNull(),
    fromId: text('from_id').notNull(),
    toKind: text('to_kind').notNull(),
    toId: text('to_id').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('entity_links_unique').on(
      table.organizationId,
      table.fromKind,
      table.fromId,
      table.toKind,
      table.toId,
      table.kind,
    ),
  ],
)

export const inspections = pgTable(
  'inspections',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id),
    number: text('number').notNull(),
    title: text('title').notNull(),
    area: text('area').notNull().default(''),
    inspector: text('inspector').notNull().default(''),
    inspectedAt: date('inspected_at'),
    result: text('result').notNull().default('pending'),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('open'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('inspections_org_number').on(table.organizationId, table.number)],
)

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  userId: text('user_id').references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const schema = {
  organizations,
  users,
  sessions,
  folders,
  formTemplates,
  formRecords,
  controlledDocuments,
  recordLinks,
  internalAudits,
  auditRecordLinks,
  trainingAssignments,
  capaInvestigations,
  capaActions,
  calibrationAssets,
  calibrationEvents,
  suppliers,
  supplierEvaluations,
  managementReviews,
  qualityRecordLinks,
  auditFindings,
  discrepancyInvestigations,
  entityLinks,
  inspections,
  auditEvents,
}

export type { FormDataMap, FormSchema }
export type Organization = typeof organizations.$inferSelect
export type User = typeof users.$inferSelect
export type Folder = typeof folders.$inferSelect
export type FormTemplate = typeof formTemplates.$inferSelect
export type FormRecord = typeof formRecords.$inferSelect
export type ControlledDocument = typeof controlledDocuments.$inferSelect
export type InternalAudit = typeof internalAudits.$inferSelect
export type TrainingAssignment = typeof trainingAssignments.$inferSelect
export type CalibrationAsset = typeof calibrationAssets.$inferSelect
export type CalibrationEvent = typeof calibrationEvents.$inferSelect
export type Supplier = typeof suppliers.$inferSelect
export type SupplierEvaluation = typeof supplierEvaluations.$inferSelect
export type ManagementReview = typeof managementReviews.$inferSelect
export type AuditFinding = typeof auditFindings.$inferSelect
export type DiscrepancyInvestigation = typeof discrepancyInvestigations.$inferSelect
export type Inspection = typeof inspections.$inferSelect

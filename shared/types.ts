export type FieldType = 'text' | 'textarea' | 'date' | 'select' | 'checkbox'

export type FormField = {
  id: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  pdfField: string
  placeholder?: string
}

export type FormSchema = {
  title: string
  description?: string
  formCode: string
  isoClause?: string
  fields: FormField[]
}

export type FormDataMap = Record<string, string | boolean>

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
}

export type NavFolder = {
  id: string
  slug: string
  label: string
  parentId: string | null
  sortOrder: number
  children: NavFolder[]
  templates: TemplateSummary[]
}

export type TemplateSummary = {
  id: string
  folderId: string
  title: string
  description: string | null
  formCode: string
  version: number
  status: 'draft' | 'effective'
}

export type FormRecordSummary = {
  id: string
  templateId: string
  folderId: string
  title: string
  status: string
  updatedAt: string
  createdAt: string
}

export type RecordLink = {
  id: string
  recordId: string
  folderId: string
  title: string
  status: string
  kind: string
  direction: 'from' | 'to'
}

/** Extensible cross-module link for tabs (audit, DI, NCR, CAPA, calibration, …). */
export type LinkedItem = {
  id: string
  kind: string
  title: string
  status: string
  folderId?: string
  recordId?: string
  auditId?: string
  discrepancyId?: string
  calibrationId?: string
  findingId?: string
  inspectionId?: string
}

export type CapaAction = {
  id: string
  kind: 'corrective' | 'preventive'
  description: string
  owner: string
  dueDate: string | null
  status: 'open' | 'done'
}

export type CapaInvestigation = {
  rootCause: string
  rcaMethod: '5-why' | 'fishbone' | 'other'
  effectivenessPlan: string
  effectivenessResult: string
  verifiedDate: string | null
  actions: CapaAction[]
}

export type FormRecordDetail = FormRecordSummary & {
  data: FormDataMap
  schema: FormSchema
  templateTitle: string
  templateSlug: string
  links: RecordLink[]
  related: LinkedItem[]
  investigation: CapaInvestigation | null
}

export type AuditStatus = 'planned' | 'in_progress' | 'completed'

export type InternalAuditSummary = {
  id: string
  folderId: string
  title: string
  number: string
  scope: string
  plannedDate: string | null
  auditor: string
  status: AuditStatus
  updatedAt: string
}

export type InternalAuditDetail = InternalAuditSummary & {
  findings: string
  structuredFindings: AuditFinding[]
  links: RecordLink[]
  related: LinkedItem[]
}

export type FindingSeverity = 'observation' | 'minor' | 'major'

export type AuditFinding = {
  id: string
  auditId: string
  severity: FindingSeverity
  clause: string
  description: string
  evidence: string
  discrepancyId: string | null
  createdAt: string
}

export type DiscrepancySummary = {
  id: string
  folderId: string
  findingId: string | null
  number: string
  status: string
  updatedAt: string
}

export type DiscrepancyDetail = DiscrepancySummary & {
  identification: string
  containment: string
  investigation: string
  disposition: string
  related: LinkedItem[]
}

export type InspectionResult = 'pending' | 'pass' | 'fail'

export type InspectionSummary = {
  id: string
  folderId: string
  number: string
  title: string
  area: string
  inspector: string
  inspectedAt: string | null
  result: InspectionResult
  status: string
  updatedAt: string
}

export type InspectionDetail = InspectionSummary & {
  notes: string
  related: LinkedItem[]
}

export type TrainingStatus = 'pending' | 'complete' | 'stale'

export type TrainingAssignmentSummary = {
  id: string
  documentId: string
  userId: string
  userName: string
  documentNumber: string
  revision: string
  documentTitle: string
  status: TrainingStatus
  completedAt: string | null
  createdAt: string
}

export type TrainingCounts = {
  pending: number
  complete: number
  stale: number
}

export type DocumentStatus = 'draft' | 'in_review' | 'effective' | 'obsolete'

export type ControlledDocumentSummary = {
  id: string
  folderId: string
  title: string
  number: string
  revision: string
  status: DocumentStatus
  effectiveDate: string | null
  updatedAt: string
  createdAt: string
  training?: TrainingCounts
}

export type ControlledDocumentDetail = ControlledDocumentSummary & {
  body: string
  training: TrainingCounts
  trainingRoles: string
}

export type CalibrationStatus = 'current' | 'due_soon' | 'overdue' | 'out_of_service'
export type CalibrationEventResult = 'in_tolerance' | 'out_of_tolerance' | 'limited'

export type CalibrationEvent = {
  id: string
  eventDate: string
  result: CalibrationEventResult
  notes: string
  asFound: string
  asLeft: string
  technician: string
  certificate: string
  createdAt: string
}

export type CalibrationSummary = {
  id: string
  folderId: string
  name: string
  number: string
  location: string
  intervalDays: number
  lastCalibrated: string | null
  nextDue: string | null
  status: CalibrationStatus
  updatedAt: string
}

export type CalibrationDetail = CalibrationSummary & {
  events: CalibrationEvent[]
  links: RecordLink[]
  related: LinkedItem[]
}

export type SupplierStatus = 'approved' | 'conditional' | 'disqualified'
export type SupplierEvalResult = 'pass' | 'fail' | 'conditional'

export type SupplierEvaluation = {
  id: string
  evalDate: string
  result: SupplierEvalResult
  score: number | null
  comments: string
  createdAt: string
}

export type SupplierSummary = {
  id: string
  folderId: string
  name: string
  number: string
  status: SupplierStatus
  lastEvaluationDate: string | null
  updatedAt: string
}

export type SupplierDetail = SupplierSummary & {
  notes: string
  evaluations: SupplierEvaluation[]
  links: RecordLink[]
  related: LinkedItem[]
}

export type ReviewStatus = 'draft' | 'completed'

export type ManagementReviewSummary = {
  id: string
  folderId: string
  number: string
  meetingDate: string | null
  status: ReviewStatus
  updatedAt: string
}

export type ManagementReviewDetail = ManagementReviewSummary & {
  attendees: string
  inputsSummary: string
  outputsActions: string
  links: RecordLink[]
  related: LinkedItem[]
}

export type SessionUser = {
  id: string
  email: string
  name: string
  organization: OrganizationSummary
}

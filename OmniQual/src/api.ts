import type {
  AuditFinding,
  AuditStatus,
  CapaAction,
  CapaInvestigation,
  CalibrationDetail,
  CalibrationEventResult,
  CalibrationSummary,
  ControlledDocumentDetail,
  ControlledDocumentSummary,
  DiscrepancyDetail,
  DiscrepancySummary,
  DocumentStatus,
  FindingSeverity,
  FormDataMap,
  FormRecordDetail,
  FormRecordSummary,
  InspectionDetail,
  InspectionResult,
  InspectionSummary,
  InternalAuditDetail,
  InternalAuditSummary,
  ManagementReviewDetail,
  ManagementReviewSummary,
  NavFolder,
  ReviewStatus,
  SessionUser,
  SupplierDetail,
  SupplierEvalResult,
  SupplierStatus,
  SupplierSummary,
  TemplateSummary,
  TrainingAssignmentSummary,
} from '../../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // keep status text
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  me: () => request<{ user: SessionUser }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (payload: {
    organizationName: string
    name: string
    email: string
    password: string
  }) =>
    request<{ user: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  nav: () => request<{ departments: NavFolder[] }>('/api/nav'),
  folderRecords: (folderId: string) =>
    request<{ records: FormRecordSummary[] }>(`/api/folders/${folderId}/records`),
  folderDocuments: (folderId: string) =>
    request<{ documents: ControlledDocumentSummary[] }>(`/api/folders/${folderId}/documents`),
  getRecord: (id: string) => request<FormRecordDetail>(`/api/records/${id}`),
  createRecord: (templateId: string, data?: FormDataMap) =>
    request<FormRecordDetail>('/api/records', {
      method: 'POST',
      body: JSON.stringify({ templateId, data }),
    }),
  saveRecord: (id: string, payload: { data?: FormDataMap; status?: string }) =>
    request<FormRecordDetail>(`/api/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createLinkedCapa: (ncrId: string) =>
    request<FormRecordDetail>(`/api/records/${ncrId}/linked-capa`, { method: 'POST' }),
  getDocument: (id: string) => request<ControlledDocumentDetail>(`/api/documents/${id}`),
  createDocument: (folderId: string, title?: string) =>
    request<ControlledDocumentDetail>('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ folderId, title }),
    }),
  saveDocument: (
    id: string,
    payload: { title?: string; number?: string; revision?: string; body?: string; trainingRoles?: string },
  ) =>
    request<ControlledDocumentDetail>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  setDocumentStatus: (id: string, status: DocumentStatus) =>
    request<ControlledDocumentDetail>(`/api/documents/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  reviseDocument: (id: string) =>
    request<ControlledDocumentDetail>(`/api/documents/${id}/revise`, { method: 'POST' }),
  folderAudits: (folderId: string) =>
    request<{ audits: InternalAuditSummary[] }>(`/api/folders/${folderId}/audits`),
  createAudit: (folderId: string, title?: string) =>
    request<InternalAuditDetail>('/api/audits', {
      method: 'POST',
      body: JSON.stringify({ folderId, title }),
    }),
  getAudit: (id: string) => request<InternalAuditDetail>(`/api/audits/${id}`),
  saveAudit: (
    id: string,
    payload: {
      title?: string
      number?: string
      scope?: string
      plannedDate?: string
      auditor?: string
      findings?: string
    },
  ) =>
    request<InternalAuditDetail>(`/api/audits/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  setAuditStatus: (id: string, status: AuditStatus) =>
    request<InternalAuditDetail>(`/api/audits/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  createAuditLinkedRecord: (id: string, type: 'ncr' | 'capa') =>
    request<FormRecordDetail>(`/api/audits/${id}/linked-record`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  folderTraining: (folderId: string) =>
    request<{ assignments: TrainingAssignmentSummary[] }>(`/api/folders/${folderId}/training`),
  getTraining: (id: string) => request<TrainingAssignmentSummary>(`/api/training/${id}`),
  completeTraining: (id: string) =>
    request<TrainingAssignmentSummary>(`/api/training/${id}/complete`, { method: 'POST' }),
  saveInvestigation: (
    recordId: string,
    payload: {
      rootCause?: string
      rcaMethod?: CapaInvestigation['rcaMethod']
      effectivenessPlan?: string
      effectivenessResult?: string
      verifiedDate?: string | null
    },
  ) =>
    request<CapaInvestigation>(`/api/records/${recordId}/investigation`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  addCapaAction: (recordId: string, kind: 'corrective' | 'preventive') =>
    request<CapaInvestigation>(`/api/records/${recordId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  saveCapaAction: (
    actionId: string,
    payload: {
      kind?: 'corrective' | 'preventive'
      description?: string
      owner?: string
      dueDate?: string | null
      status?: 'open' | 'done'
    },
  ) =>
    request<CapaInvestigation>(`/api/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  folderCalibration: (folderId: string) =>
    request<{ assets: CalibrationSummary[] }>(`/api/folders/${folderId}/calibration`),
  createCalibration: (folderId: string, name?: string) =>
    request<CalibrationDetail>('/api/calibration', {
      method: 'POST',
      body: JSON.stringify({ folderId, name }),
    }),
  getCalibration: (id: string) => request<CalibrationDetail>(`/api/calibration/${id}`),
  saveCalibration: (
    id: string,
    payload: { name?: string; number?: string; location?: string; intervalDays?: number; status?: string },
  ) =>
    request<CalibrationDetail>(`/api/calibration/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  recordCalibrationEvent: (
    id: string,
    payload: {
      date: string
      result: CalibrationEventResult
      notes?: string
      asFound?: string
      asLeft?: string
      technician?: string
      certificate?: string
    },
  ) =>
    request<CalibrationDetail>(`/api/calibration/${id}/events`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createCalibrationLinkedRecord: (id: string) =>
    request<FormRecordDetail>(`/api/calibration/${id}/linked-record`, { method: 'POST' }),
  folderSuppliers: (folderId: string) =>
    request<{ suppliers: SupplierSummary[] }>(`/api/folders/${folderId}/suppliers`),
  createSupplier: (folderId: string, name?: string) =>
    request<SupplierDetail>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify({ folderId, name }),
    }),
  getSupplier: (id: string) => request<SupplierDetail>(`/api/suppliers/${id}`),
  saveSupplier: (
    id: string,
    payload: { name?: string; number?: string; notes?: string; status?: SupplierStatus },
  ) =>
    request<SupplierDetail>(`/api/suppliers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  recordSupplierEvaluation: (
    id: string,
    payload: { date: string; result: SupplierEvalResult; score?: number | null; comments?: string },
  ) =>
    request<SupplierDetail>(`/api/suppliers/${id}/evaluations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createSupplierLinkedRecord: (id: string, type: 'ncr' | 'capa') =>
    request<FormRecordDetail>(`/api/suppliers/${id}/linked-record`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  folderReviews: (folderId: string) =>
    request<{ reviews: ManagementReviewSummary[] }>(`/api/folders/${folderId}/reviews`),
  createReview: (folderId: string) =>
    request<ManagementReviewDetail>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ folderId }),
    }),
  getReview: (id: string) => request<ManagementReviewDetail>(`/api/reviews/${id}`),
  saveReview: (
    id: string,
    payload: {
      number?: string
      meetingDate?: string
      attendees?: string
      inputsSummary?: string
      outputsActions?: string
    },
  ) =>
    request<ManagementReviewDetail>(`/api/reviews/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  setReviewStatus: (id: string, status: ReviewStatus) =>
    request<ManagementReviewDetail>(`/api/reviews/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  createReviewLinkedRecord: (id: string) =>
    request<FormRecordDetail>(`/api/reviews/${id}/linked-record`, { method: 'POST' }),
  addAuditFinding: (
    auditId: string,
    payload: { severity: FindingSeverity; clause: string; description: string; evidence: string },
  ) =>
    request<{ finding: AuditFinding; discrepancy: DiscrepancyDetail | null }>(`/api/audits/${auditId}/findings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createFindingDiscrepancy: (findingId: string) =>
    request<DiscrepancyDetail>(`/api/findings/${findingId}/discrepancy`, { method: 'POST' }),
  folderDiscrepancies: (folderId: string) =>
    request<{ discrepancies: DiscrepancySummary[] }>(`/api/folders/${folderId}/discrepancies`),
  getDiscrepancy: (id: string) => request<DiscrepancyDetail>(`/api/discrepancies/${id}`),
  saveDiscrepancy: (
    id: string,
    payload: {
      identification?: string
      containment?: string
      investigation?: string
      disposition?: string
      status?: string
    },
  ) =>
    request<DiscrepancyDetail>(`/api/discrepancies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createDiscrepancyLinkedRecord: (id: string, type: 'ncr' | 'capa') =>
    request<FormRecordDetail>(`/api/discrepancies/${id}/linked-record`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  folderInspections: (folderId: string) =>
    request<{ inspections: InspectionSummary[] }>(`/api/folders/${folderId}/inspections`),
  createInspection: (folderId: string, title?: string) =>
    request<InspectionDetail>('/api/inspections', {
      method: 'POST',
      body: JSON.stringify({ folderId, title }),
    }),
  getInspection: (id: string) => request<InspectionDetail>(`/api/inspections/${id}`),
  saveInspection: (
    id: string,
    payload: {
      title?: string
      area?: string
      inspector?: string
      inspectedAt?: string
      result?: InspectionResult
      notes?: string
      status?: string
    },
  ) =>
    request<InspectionDetail>(`/api/inspections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createInspectionLinkedRecord: (id: string, type: 'ncr' | 'capa' | 'discrepancy') =>
    request<FormRecordDetail>(`/api/inspections/${id}/linked-record`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),
  searchRecords: (opts: {
    type: 'ncr' | 'capa'
    q?: string
    sourceKind: 'discrepancy' | 'audit' | 'calibration' | 'inspection' | 'ncr'
    sourceId: string
  }) => {
    const params = new URLSearchParams({
      type: opts.type,
      sourceKind: opts.sourceKind,
      sourceId: opts.sourceId,
    })
    if (opts.q) params.set('q', opts.q)
    return request<{ records: FormRecordSummary[] }>(`/api/records/search?${params}`)
  },
  attachRecord: (opts: {
    type: 'ncr' | 'capa'
    recordId: string
    sourceKind: 'discrepancy' | 'audit' | 'calibration' | 'inspection' | 'ncr'
    sourceId: string
  }) =>
    request<{ id: string; folderId: string; title: string; status: string; templateId: string }>('/api/records/attach', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  templatePdfUrl: (templateId: string) => `/api/templates/${templateId}/pdf`,
  recordPdfUrl: (recordId: string, flatten = true) =>
    `/api/records/${recordId}/pdf?download=1&flatten=${flatten ? '1' : '0'}`,
}

export type {
  NavFolder,
  TemplateSummary,
  FormRecordSummary,
  FormRecordDetail,
  FormDataMap,
  SessionUser,
  ControlledDocumentSummary,
  ControlledDocumentDetail,
  DocumentStatus,
  InternalAuditSummary,
  InternalAuditDetail,
  AuditStatus,
  TrainingAssignmentSummary,
  CapaInvestigation,
  CapaAction,
  CalibrationSummary,
  CalibrationDetail,
  CalibrationEventResult,
  SupplierSummary,
  SupplierDetail,
  SupplierStatus,
  SupplierEvalResult,
  ManagementReviewSummary,
  ManagementReviewDetail,
  ReviewStatus,
  DiscrepancySummary,
  DiscrepancyDetail,
  InspectionSummary,
  InspectionDetail,
  InspectionResult,
  AuditFinding,
  FindingSeverity,
}

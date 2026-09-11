import type { LinkedItem } from '../../../shared/types.ts'

type Props = {
  items: LinkedItem[] | undefined
  onOpen: (item: LinkedItem) => void
}

const KIND_LABEL: Record<string, string> = {
  audit: 'Audit',
  finding: 'Finding',
  discrepancy: 'DI',
  ncr: 'NCR',
  capa: 'CAPA',
  form: 'Record',
  calibration: 'Cal',
  inspection: 'INSP',
  supplier: 'Supplier',
  review: 'Review',
  management_review: 'Review',
}

export function LinkedRecords({ items, onOpen }: Props) {
  const list = items ?? []
  return (
    <div className="linked-strip">
      <span className="linked-label">Linked records</span>
      {list.length === 0 ? (
        <span className="muted">None yet</span>
      ) : (
        list.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            className="linkish"
            onClick={() => onOpen(item)}
          >
            {KIND_LABEL[item.kind] ?? item.kind} {item.title}
          </button>
        ))
      )}
    </div>
  )
}

export function calStatusLabel(status: string) {
  if (status === 'due_soon') return 'Due in <30 days'
  if (status === 'current') return 'In tolerance'
  if (status === 'out_of_service') return 'Out of service'
  if (status === 'overdue') return 'Overdue'
  return status.replaceAll('_', ' ')
}

export function calRowClass(status: string) {
  if (status === 'overdue') return 'row-overdue'
  if (status === 'due_soon') return 'row-due-soon'
  if (status === 'out_of_service') return 'row-oos'
  return 'row-current'
}

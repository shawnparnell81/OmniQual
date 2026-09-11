import type { FormDataMap, FormField, FormSchema } from '../../../shared/types.ts'

type Props = {
  schema: FormSchema
  data: FormDataMap
  onChange: (id: string, value: string | boolean) => void
}

export function FormFields({ schema, data, onChange }: Props) {
  return (
    <div className="form-fields">
      <header>
        <p className="form-code">{schema.formCode}</p>
        <h2>{schema.title}</h2>
        {schema.description ? <p>{schema.description}</p> : null}
        {schema.isoClause ? <p className="muted">{schema.isoClause}</p> : null}
        <p className="iso-help">Required fields are marked *.</p>
      </header>
      {schema.fields.map((field) => (
        <Field key={field.id} field={field} value={data[field.id]} onChange={onChange} />
      ))}
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: string | boolean | undefined
  onChange: (id: string, value: string | boolean) => void
}) {
  const id = `field-${field.id}`

  if (field.type === 'checkbox') {
    return (
      <label className="check-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(field.id, event.target.checked)}
        />
        {field.label}
      </label>
    )
  }

  return (
    <label htmlFor={id}>
      {field.label}
      {field.required ? <span className="req"> *</span> : null}
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          rows={4}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      ) : field.type === 'select' ? (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(field.id, event.target.value)}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      )}
    </label>
  )
}

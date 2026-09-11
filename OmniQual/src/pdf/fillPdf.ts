import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { FormDataMap } from '../../../shared/types.ts'

export async function fillPdf(templateBytes: ArrayBuffer, data: FormDataMap) {
  const doc = await PDFDocument.load(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()

  for (const [name, value] of Object.entries(data)) {
    try {
      const field = form.getField(name)
      const typeName = field.constructor.name
      if (typeName.includes('CheckBox')) {
        const box = form.getCheckBox(name)
        if (value === true || value === 'true') box.check()
        else box.uncheck()
      } else if (typeName.includes('Dropdown')) {
        const dropdown = form.getDropdown(name)
        const text = String(value ?? '')
        if (text) dropdown.select(text)
      } else {
        form.getTextField(name).setText(String(value ?? ''))
      }
    } catch {
      // Template field names can lag a schema revision.
    }
  }

  form.updateFieldAppearances(font)
  return doc.save()
}

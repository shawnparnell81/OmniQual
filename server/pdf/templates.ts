import {
  PDFDocument,
  PDFFont,
  PDFForm,
  PDFPage,
  StandardFonts,
  rgb,
  type RGB,
} from 'pdf-lib'
import type { FormField, FormSchema } from '../../shared/types.ts'

const PAGE = { width: 612, height: 792 }
const navy: RGB = rgb(0.043, 0.122, 0.2)
const teal: RGB = rgb(0.12, 0.62, 0.54)
const muted: RGB = rgb(0.35, 0.42, 0.48)
const line: RGB = rgb(0.78, 0.82, 0.86)
const paper: RGB = rgb(1, 1, 1)

type Cursor = { page: PDFPage; y: number }

export async function buildTemplatePdf(schema: FormSchema): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const form = doc.getForm()
  const cursor: Cursor = { page: doc.addPage([PAGE.width, PAGE.height]), y: PAGE.height - 36 }

  drawHeader(cursor, bold, font, schema)

  for (const field of schema.fields) {
    ensureSpace(doc, cursor, fieldHeight(field))
    drawField(form, cursor, font, field)
  }

  form.updateFieldAppearances(font)

  ensureSpace(doc, cursor, 48)
  cursor.page.drawText('Controlled quality record. Edit in OmniQual; export PDF for audit packs only.', {
    x: 48,
    y: 28,
    size: 8,
    font,
    color: muted,
  })

  return doc.save()
}

function fieldHeight(field: FormField) {
  if (field.type === 'textarea') return 92
  if (field.type === 'checkbox') return 28
  return 44
}

function ensureSpace(doc: PDFDocument, cursor: Cursor, needed: number) {
  if (cursor.y - needed < 48) {
    cursor.page = doc.addPage([PAGE.width, PAGE.height])
    cursor.y = PAGE.height - 48
  }
}

function drawHeader(cursor: Cursor, bold: PDFFont, font: PDFFont, schema: FormSchema) {
  const { page } = cursor
  page.drawRectangle({
    x: 0,
    y: PAGE.height - 72,
    width: PAGE.width,
    height: 72,
    color: navy,
  })
  page.drawRectangle({
    x: 0,
    y: PAGE.height - 76,
    width: PAGE.width,
    height: 4,
    color: teal,
  })
  page.drawText('OMNIQUAL QMS', {
    x: 48,
    y: PAGE.height - 32,
    size: 10,
    font: bold,
    color: paper,
  })
  page.drawText(schema.formCode, {
    x: PAGE.width - 160,
    y: PAGE.height - 32,
    size: 10,
    font,
    color: paper,
  })
  page.drawText(schema.title, {
    x: 48,
    y: PAGE.height - 54,
    size: 16,
    font: bold,
    color: paper,
  })
  if (schema.isoClause) {
    page.drawText(schema.isoClause, {
      x: PAGE.width - 220,
      y: PAGE.height - 54,
      size: 9,
      font,
      color: rgb(0.75, 0.88, 0.84),
    })
  }
  cursor.y = PAGE.height - 100
  if (schema.description) {
    page.drawText(schema.description, {
      x: 48,
      y: cursor.y,
      size: 9,
      font,
      color: muted,
    })
    cursor.y -= 28
  }
}

function drawField(form: PDFForm, cursor: Cursor, font: PDFFont, field: FormField) {
  const { page } = cursor
  const x = 48
  const width = PAGE.width - 96

  page.drawText(field.label + (field.required ? ' *' : ''), {
    x,
    y: cursor.y,
    size: 9,
    font,
    color: navy,
  })
  cursor.y -= 6

  if (field.type === 'checkbox') {
    const box = form.createCheckBox(field.pdfField)
    box.addToPage(page, { x, y: cursor.y - 14, width: 14, height: 14 })
    page.drawText('Yes / complete', {
      x: x + 22,
      y: cursor.y - 12,
      size: 9,
      font,
      color: muted,
    })
    cursor.y -= 28
    return
  }

  if (field.type === 'textarea') {
    const height = 64
    cursor.y -= height
    page.drawRectangle({
      x,
      y: cursor.y,
      width,
      height,
      borderColor: line,
      borderWidth: 1,
      color: paper,
    })
    const text = form.createTextField(field.pdfField)
    text.enableMultiline()
    text.addToPage(page, {
      x: x + 2,
      y: cursor.y + 2,
      width: width - 4,
      height: height - 4,
      font,
      fontSize: 10,
    })
    cursor.y -= 16
    return
  }

  const height = 22
  cursor.y -= height
  page.drawRectangle({
    x,
    y: cursor.y,
    width,
    height,
    borderColor: line,
    borderWidth: 1,
    color: paper,
  })

  if (field.type === 'select' && field.options?.length) {
    const dropdown = form.createDropdown(field.pdfField)
    dropdown.addOptions(field.options)
    dropdown.addToPage(page, {
      x: x + 2,
      y: cursor.y + 2,
      width: width - 4,
      height: height - 4,
      font,
      fontSize: 10,
    })
  } else {
    const text = form.createTextField(field.pdfField)
    text.addToPage(page, {
      x: x + 2,
      y: cursor.y + 2,
      width: width - 4,
      height: height - 4,
      font,
      fontSize: 10,
    })
  }
  cursor.y -= 16
}

export async function fillPdfBytes(
  templateBytes: Uint8Array,
  data: Record<string, string | boolean>,
  flatten = false,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()

  for (const [name, value] of Object.entries(data)) {
    try {
      const field = form.getField(name)
      const typeName = field.constructor.name
      if (typeName.includes('CheckBox')) {
        const box = form.getCheckBox(name)
        if (value === true || value === 'true' || value === 'Yes') box.check()
        else box.uncheck()
      } else if (typeName.includes('Dropdown')) {
        const dropdown = form.getDropdown(name)
        const text = String(value ?? '')
        if (text) dropdown.select(text)
      } else {
        const textField = form.getTextField(name)
        textField.setText(String(value ?? ''))
      }
    } catch {
      // Field may not exist on this template revision.
    }
  }

  form.updateFieldAppearances(font)

  if (flatten) {
    form.flatten()
  }

  return doc.save()
}

export function pdfToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

export function pdfFromBase64(b64: string) {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

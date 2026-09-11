import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { FormDataMap } from '../../../shared/types.ts'
import { fillPdf } from '../pdf/fillPdf.ts'

GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  templateBytes: ArrayBuffer
  data: FormDataMap
}

export function PdfPreview({ templateBytes, data }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host
    let cancelled = false

    const timer = window.setTimeout(() => {
      void render()
    }, 120)

    async function render() {
      try {
        const filled = await fillPdf(templateBytes, data)
        if (cancelled) return
        const pdf = await getDocument({ data: filled.slice() }).promise
        if (cancelled) {
          await pdf.destroy()
          return
        }
        root.replaceChildren()
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber)
          if (cancelled) break
          const viewport = page.getViewport({ scale: 1.35 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'pdf-page'
          const context = canvas.getContext('2d')
          if (!context) continue
          root.appendChild(canvas)
          await page.render({ canvasContext: context, viewport, canvas }).promise
        }
        await pdf.destroy()
        if (!cancelled) setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'PDF preview failed')
      }
    }

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [templateBytes, data])

  return (
    <div className="pdf-preview">
      {error ? <p className="form-error">{error}</p> : null}
      <div ref={hostRef} className="pdf-pages" />
    </div>
  )
}

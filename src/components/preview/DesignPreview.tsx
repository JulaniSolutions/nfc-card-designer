import { useEffect, useState } from 'react'
import { useDesignStore } from '@/store/design-store'
import { getMaterial, getVariation } from '@/config/materials'
import { CARD_CORNER_RADIUS } from '@/config/canvas'
import { renderCanvasToImage } from '@/lib/render-preview'
import { Loader2, Pencil, FileDown, ImageDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportDesignAsPdf } from '@/lib/export-pdf'
import JSZip from 'jszip'

interface SourceFile {
  url: string
  name: string
}

function extractSourceFiles(frontJson: string | null, backJson: string | null): SourceFile[] {
  const files: SourceFile[] = []
  const seen = new Set<string>()

  for (const json of [frontJson, backJson]) {
    if (!json) continue
    try {
      const parsed = JSON.parse(json)
      for (const obj of parsed.objects ?? []) {
        if (!obj._designId) continue
        const url = obj._originalAssetUrl || obj._assetUrl
        if (!url || seen.has(url)) continue
        seen.add(url)
        files.push({ url, name: obj._assetName || 'image' })
      }
    } catch { /* skip malformed JSON */ }
  }
  return files
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function downloadSourceFiles(files: SourceFile[]) {
  if (files.length === 1) {
    const res = await fetch(files[0].url)
    const blob = await res.blob()
    triggerBlobDownload(blob, files[0].name)
    return
  }

  const zip = new JSZip()
  await Promise.all(files.map(async (file) => {
    const res = await fetch(file.url)
    const blob = await res.blob()
    zip.file(file.name, blob)
  }))
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(zipBlob, 'source-files.zip')
}

interface DesignPreviewProps {
  onEdit: () => void
}

export function DesignPreview({ onEdit }: DesignPreviewProps) {
  const {
    frontCanvasJson,
    backCanvasJson,
    frontBgColor,
    backBgColor,
    variationId,
    materialId,
    designName,
    designMethod,
    backOption,
    variableFields,
    cardData,
    quantity,
  } = useDesignStore()

  const [frontImage, setFrontImage] = useState<string | null>(null)
  const [backImage, setBackImage] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  const [downloadingSource, setDownloadingSource] = useState(false)

  const material = materialId ? getMaterial(materialId) : null
  const variation = variationId ? getVariation(variationId) : null
  const sourceFiles = extractSourceFiles(frontCanvasJson, backCanvasJson)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const [front, back] = await Promise.all([
        renderCanvasToImage(frontCanvasJson, frontBgColor, variationId, 'front'),
        renderCanvasToImage(backCanvasJson, backBgColor, variationId, 'back'),
      ])

      if (!cancelled) {
        setFrontImage(front)
        setBackImage(back)
        setRendering(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, variationId])

  if (rendering) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Preparing preview...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {designName || 'Untitled Design'}
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {material && <span>{material.name}</span>}
            {material && variation && <span>&middot;</span>}
            {variation && <span>{variation.name}</span>}
            {(material || variation) && <span>&middot;</span>}
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize">
              {designMethod}
            </span>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">
              Front
            </p>
            <img
              src={frontImage!}
              alt="Front of card"
              className="w-full shadow-lg"
              style={{ borderRadius: CARD_CORNER_RADIUS }}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">
              Back
            </p>
            <img
              src={backImage!}
              alt="Back of card"
              className="w-full shadow-lg"
              style={{ borderRadius: CARD_CORNER_RADIUS }}
            />
          </div>
        </div>

        {/* Card variables */}
        {backOption === 'qr-name' && cardData.length > 0 && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 text-center">
              Card Details — {quantity} {quantity === 1 ? 'card' : 'cards'}
            </h2>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2 w-8">#</th>
                    {variableFields.map((field) => (
                      <th key={field.id} className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cardData.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="text-xs text-muted-foreground px-4 py-2">{i + 1}</td>
                      {variableFields.map((field) => (
                        <td key={field.id} className="px-4 py-2 text-foreground">
                          {row[field.id] || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-center gap-3">
          <Button
            size="lg"
            className="gap-2"
            onClick={async () => {
              try {
                await exportDesignAsPdf()
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Failed to export PDF')
              }
            }}
          >
            <FileDown className="size-4" />
            Download PDF
          </Button>
          {sourceFiles.length > 0 && (
            <Button
              size="lg"
              variant="outline"
              className="gap-2"
              disabled={downloadingSource}
              onClick={async () => {
                setDownloadingSource(true)
                try {
                  await downloadSourceFiles(sourceFiles)
                } catch {
                  alert('Failed to download source files')
                } finally {
                  setDownloadingSource(false)
                }
              }}
            >
              {downloadingSource ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
              {downloadingSource ? 'Downloading...' : 'Download Source Files'}
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={onEdit} className="gap-2">
            <Pencil className="size-4" />
            Edit Design
          </Button>
        </div>
      </div>
    </div>
  )
}

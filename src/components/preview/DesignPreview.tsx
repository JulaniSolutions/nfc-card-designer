import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDesignStore, type BackOption, type DesignMethod, type VariableField } from '@/store/design-store'
import { getMaterial, getVariation } from '@/config/materials'
import { CARD_CORNER_RADIUS } from '@/config/canvas'
import { renderCanvasToImage } from '@/lib/render-preview'
import { Loader2, Pencil, FileDown, Printer, Lock, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportDesignAsPdf } from '@/lib/export-pdf'
import { exportPrintFiles, type PrintExportSnapshot } from '@/lib/export-print'
import { triggerBlobDownload } from '@/lib/download'
import { parseProductionParams } from '@/lib/production-params'
import { ProductionPanel } from '@/components/production/ProductionPanel'

/**
 * Snapshot overrides. When omitted the preview reads the design store, exactly as it
 * always has. Templates pass their own snapshot so that merely *viewing* one never
 * touches the store — and so never clobbers the visitor's in-progress design.
 */
interface DesignPreviewSnapshot {
  frontCanvasJson?: string | null
  backCanvasJson?: string | null
  frontBgColor?: string
  backBgColor?: string
  materialId?: string | null
  variationId?: string | null
  designMethod?: DesignMethod
  backOption?: BackOption
  variableFields?: VariableField[]
}

interface DesignPreviewProps extends DesignPreviewSnapshot {
  onEdit: () => void
  mode?: 'design' | 'template'
  templateName?: string
  useCount?: number
  warning?: string | null
}

export function DesignPreview({
  onEdit,
  mode = 'design',
  templateName,
  useCount,
  warning,
  frontCanvasJson: frontCanvasJsonProp,
  backCanvasJson: backCanvasJsonProp,
  frontBgColor: frontBgColorProp,
  backBgColor: backBgColorProp,
  materialId: materialIdProp,
  variationId: variationIdProp,
  designMethod: designMethodProp,
  backOption: backOptionProp,
  variableFields: variableFieldsProp,
}: DesignPreviewProps) {
  const store = useDesignStore()
  const { designName, cardData, quantity, designId } = store
  const [searchParams] = useSearchParams()

  const isTemplate = mode === 'template'

  // `undefined` means "not overridden" — `null` is a legitimate override value for canvas JSON.
  const frontCanvasJson = frontCanvasJsonProp !== undefined ? frontCanvasJsonProp : store.frontCanvasJson
  const backCanvasJson = backCanvasJsonProp !== undefined ? backCanvasJsonProp : store.backCanvasJson
  const frontBgColor = frontBgColorProp !== undefined ? frontBgColorProp : store.frontBgColor
  const backBgColor = backBgColorProp !== undefined ? backBgColorProp : store.backBgColor
  const materialId = materialIdProp !== undefined ? materialIdProp : store.materialId
  const variationId = variationIdProp !== undefined ? variationIdProp : store.variationId
  const designMethod = designMethodProp !== undefined ? designMethodProp : store.designMethod
  const backOption = backOptionProp !== undefined ? backOptionProp : store.backOption
  const variableFields = variableFieldsProp !== undefined ? variableFieldsProp : store.variableFields

  const [frontImage, setFrontImage] = useState<string | null>(null)
  const [backImage, setBackImage] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  const [exportingPrint, setExportingPrint] = useState(false)
  const [printWarnings, setPrintWarnings] = useState<string[]>([])

  const material = materialId ? getMaterial(materialId) : null
  const variation = variationId ? getVariation(variationId) : null

  /**
   * What this page is *showing*, ready for the print export.
   *
   * A shared design page is not the editor: passing an explicit snapshot keeps the
   * export off the live canvases, which belong to whatever the visitor last had
   * open. Memoised because the production panel re-renders its preview whenever the
   * snapshot identity changes.
   */
  const printSnapshot: PrintExportSnapshot = useMemo(
    () => ({
      frontCanvasJson,
      backCanvasJson,
      frontBgColor,
      backBgColor,
      materialId,
      variationId,
      designMethod,
      backOption,
      quantity,
      cardData,
      variableFields,
      designName,
    }),
    [
      frontCanvasJson,
      backCanvasJson,
      frontBgColor,
      backBgColor,
      materialId,
      variationId,
      designMethod,
      backOption,
      quantity,
      cardData,
      variableFields,
      designName,
    ],
  )

  // The production panel is staff-only and stateless: it appears solely when the
  // deep-link parameters are present, and only for a saved design (never a template,
  // never an unsaved draft) — there is nothing to hand a supplier otherwise.
  const searchString = searchParams.toString()
  const productionParams = useMemo(
    () => (isTemplate || !designId ? null : parseProductionParams(new URLSearchParams(searchString))),
    [isTemplate, designId, searchString],
  )

  // Template links get pasted into orders in place of design links. Detect that
  // exact mistake — same parser, so the two can never disagree about what counts
  // as a production link — and explain it instead of rendering an ordinary page.
  const productionParamsOnTemplate = useMemo(
    () => isTemplate && parseProductionParams(new URLSearchParams(searchString)) !== null,
    [isTemplate, searchString],
  )

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

  const handleDownloadPdf = async () => {
    try {
      // A template page never populates the store, so exporting from it would
      // otherwise produce the visitor's own design — blank at best, and at worst
      // their artwork and card list under someone else's template name.
      await exportDesignAsPdf(
        isTemplate
          ? {
              frontCanvasJson,
              backCanvasJson,
              frontBgColor,
              backBgColor,
              materialId,
              designMethod,
              // A template carries no per-card values, so it is always a single proof card.
              quantity: 1,
              cardData: [{}],
            }
          : undefined,
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export PDF')
    }
  }

  const handleDownloadPrintFiles = async () => {
    // Print files are a production artefact of a real design — a template carries
    // no card data and no order behind it, so the button never renders there.
    if (isTemplate) return

    setExportingPrint(true)
    setPrintWarnings([])
    try {
      const result = await exportPrintFiles(printSnapshot)
      triggerBlobDownload(result.blob, result.filename)
      setPrintWarnings(result.warnings)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export print files')
    } finally {
      setExportingPrint(false)
    }
  }

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
          {isTemplate ? (
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {templateName || 'Untitled Template'}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <Lock className="size-3" />
                Template
              </span>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold text-foreground">
              {designName || 'Untitled Design'}
            </h1>
          )}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {material && <span>{material.name}</span>}
            {material && variation && <span>&middot;</span>}
            {variation && <span>{variation.name}</span>}
            {(material || variation) && <span>&middot;</span>}
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize">
              {designMethod}
            </span>
          </div>
          {isTemplate && useCount !== undefined && useCount > 0 && (
            <p className="text-xs text-muted-foreground/70">
              Used {useCount} {useCount === 1 ? 'time' : 'times'}
            </p>
          )}
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

        {/* Personalisation fields — a template carries field definitions but no values */}
        {isTemplate && backOption === 'qr-name' && variableFields.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Personalisation fields: {variableFields.map((field) => field.label).join(', ')}
          </p>
        )}

        {/* Card variables */}
        {!isTemplate && backOption === 'qr-name' && cardData.length > 0 && (
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

        {warning && (
          <div className="max-w-xl mx-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <p className="text-xs text-amber-700 dark:text-amber-400 text-center">{warning}</p>
          </div>
        )}

        {printWarnings.length > 0 && (
          <div className="max-w-xl mx-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 space-y-1.5">
            {printWarnings.map((printWarning, i) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-400 text-center">
                {printWarning}
              </p>
            ))}
          </div>
        )}

        {productionParamsOnTemplate && (
          <div className="max-w-xl mx-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <p className="text-xs text-amber-700 dark:text-amber-400 text-center">
              This is a <span className="font-medium">template</span> link, so there are no
              production files to prepare — a template carries no card details and belongs to no
              order. Open the customer&rsquo;s design link (
              <span className="font-mono">/design/…</span>) from the order instead.
            </p>
          </div>
        )}

        {/* Production panel — hidden unless the deep-link parameters are present */}
        {productionParams && (
          <ProductionPanel
            // Remount on a different link so the paste box refills from the new refs.
            key={searchString}
            params={productionParams}
            snapshot={printSnapshot}
          />
        )}

        {/* Actions */}
        <div className="flex justify-center gap-3">
          {isTemplate ? (
            <>
              <Button size="lg" className="gap-2" onClick={onEdit}>
                <Wand2 className="size-4" />
                Use this template
              </Button>
              <Button size="lg" variant="outline" className="gap-2" onClick={handleDownloadPdf}>
                <FileDown className="size-4" />
                Download PDF
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" className="gap-2" onClick={handleDownloadPdf}>
                <FileDown className="size-4" />
                Download Preview
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                disabled={exportingPrint}
                onClick={handleDownloadPrintFiles}
              >
                {exportingPrint ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                {exportingPrint ? 'Preparing files...' : 'Download Print Files'}
              </Button>
              <Button size="lg" variant="outline" onClick={onEdit} className="gap-2">
                <Pencil className="size-4" />
                Edit Design
              </Button>
            </>
          )}
        </div>

        {/* Said on every template page, not only when a production link arrives: this
            page's URL is the one people copy out of the address bar and send in when
            they mean to order. */}
        {isTemplate && (
          <p className="max-w-xl mx-auto text-xs text-muted-foreground text-center">
            Ordering cards? Don&rsquo;t send us this template link &mdash; it carries no card
            details. Choose <span className="font-medium text-foreground">Use this template</span>,
            add your details, then save your design and send us that link instead.
          </p>
        )}
      </div>
    </div>
  )
}

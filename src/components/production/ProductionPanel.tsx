import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CloudUpload,
  Copy,
  ExternalLink,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getVariation } from '@/config/materials'
import { CARD_CORNER_RADIUS } from '@/config/canvas'
import { isLegacyPrintedMetal, LEGACY_PRINTED_METAL_NOTICE } from '@/lib/design-method'
import { triggerBlobDownload, type BundleFile } from '@/lib/download'
import {
  DRIVE_SETUP_DOC,
  DriveError,
  postProductionLink,
  saveBundleToDrive,
  type DriveSaveResult,
  type DriveUploadProgress,
} from '@/lib/drive'
import {
  backFileCount,
  describeCardUrlIssues,
  describeQrCoverage,
  exportPrintFiles,
  refFromCardUrl,
  renderBackPrintPreview,
  renderFrontPrintPreview,
  type BackPrintPreview,
  type PrintExportSnapshot,
  type SidePrintPreview,
} from '@/lib/export-print'
import { isCardUrl, parseCardUrlLines, type ProductionParams } from '@/lib/production-params'
import { cn } from '@/lib/utils'

/**
 * The staff-facing production panel (PLAN-02).
 *
 * Hidden behind the deep-link query parameters, so a customer opening a plain
 * `/design/:id` link never sees it. Everything here is component-local: the card
 * URLs come from the link (or the operator's paste) and go straight into the print
 * bundle. Nothing is written to the Zustand store or to Supabase — WordPress's ref
 * pool stays the single source of truth for what each card points at, and a
 * production visit must never dirty the design a customer might reopen.
 *
 * The QR codes exist only on the offscreen canvases inside `export-print.ts`; they
 * never reach `window.__fabricCanvasBack`.
 */

/** A full offscreen Fabric load per keystroke would be unusable. */
const PREVIEW_DEBOUNCE_MS = 500

interface ProductionPanelProps {
  /** Parsed deep-link parameters — the panel only renders when these exist. */
  params: ProductionParams
  /** The design being previewed, built by `DesignPreview` from what it is showing. */
  snapshot: PrintExportSnapshot
}

interface CardRow {
  index: number
  url: string
  valid: boolean
  ref: string
  /** Beyond the card count: a supplied URL with no card to print it on. */
  unused: boolean
}

/**
 * Drive delivery is a small state machine rather than a pair of booleans, because
 * "paused half-way with files already in Drive" and "finished but WordPress did
 * not take the link" are both success-ish states the operator has to act on.
 */
type DriveState = 'idle' | 'confirm' | 'preparing' | 'uploading' | 'paused' | 'done' | 'error'

/** The built bundle, kept so "Retry remaining" resumes rather than re-renders. */
interface DriveBundle {
  folderName: string
  files: BundleFile[]
}

/** `print/back-01-aaa111.png` → `back-01-aaa111`, which is what fits in a status line. */
function fileLabel(path: string): string {
  return path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
}

interface PrintFilePreviewProps {
  label: string
  alt: string
  /**
   * The card body photo, shown *behind* the render. Print files carry artwork only,
   * so a white-on-transparent design would otherwise be invisible here — and the
   * operator would be checking a blank box.
   */
  cardImage?: string
  preview: SidePrintPreview | null
  loading: boolean
  caption: string
}

/** One side's print render, framed at card proportions with its own status line. */
function PrintFilePreview({ label, alt, cardImage, preview, loading, caption }: PrintFilePreviewProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div
        className="relative w-full overflow-hidden border border-border bg-muted"
        style={{
          borderRadius: CARD_CORNER_RADIUS,
          aspectRatio: '1012 / 638',
          backgroundImage: cardImage ? `url(${cardImage})` : undefined,
          backgroundSize: 'cover',
        }}
      >
        {preview && <img src={preview.dataUrl} alt={alt} className="w-full" />}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] leading-4 text-muted-foreground">{caption}</p>
        {preview?.warnings.map((warning, i) => (
          <p key={i} className="text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            {warning}
          </p>
        ))}
      </div>
    </div>
  )
}

export function ProductionPanel({ params, snapshot }: ProductionPanelProps) {
  // Pre-filled from the link, then owned by the operator. `DesignPreview` keys this
  // component on the query string, so arriving at a different order's link remounts
  // the panel and refills the box rather than needing a sync effect.
  const [text, setText] = useState(() => params.cardUrls.join('\n'))

  const [frontPreview, setFrontPreview] = useState<SidePrintPreview | null>(null)
  const [frontPreviewing, setFrontPreviewing] = useState(true)
  const [backPreview, setBackPreview] = useState<BackPrintPreview | null>(null)
  const [backPreviewing, setBackPreviewing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportWarnings, setExportWarnings] = useState<string[]>([])
  const [exportError, setExportError] = useState<string | null>(null)

  const [driveState, setDriveState] = useState<DriveState>('idle')
  const [driveProgress, setDriveProgress] = useState<DriveUploadProgress | null>(null)
  const [driveResult, setDriveResult] = useState<DriveSaveResult | null>(null)
  const [driveError, setDriveError] = useState<{ message: string; reauth: boolean } | null>(null)
  const [writeBackRetrying, setWriteBackRetrying] = useState(false)
  const [copied, setCopied] = useState(false)
  const bundleRef = useRef<DriveBundle | null>(null)

  const { cardUrls } = useMemo(() => parseCardUrlLines(text), [text])

  const backCount = backFileCount(snapshot.backOption, snapshot.cardData.length, cardUrls.length)
  const assigned = Math.min(cardUrls.length, backCount)

  const rows: CardRow[] = useMemo(() => {
    const lines = text.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean)
    let cardIndex = 0
    return lines.map((line, index) => {
      const valid = isCardUrl(line)
      const row: CardRow = {
        index,
        url: line,
        valid,
        ref: valid ? refFromCardUrl(line) : '',
        unused: valid && cardIndex >= backCount,
      }
      if (valid) cardIndex++
      return row
    })
  }, [text, backCount])

  const warnings = useMemo(
    () => [
      ...describeQrCoverage(cardUrls.length, backCount, snapshot.qrRemoved),
      ...describeCardUrlIssues(cardUrls),
    ],
    [cardUrls, backCount, snapshot.qrRemoved],
  )

  const legacyPrintedMetal = isLegacyPrintedMetal(snapshot.materialId, snapshot.designMethod)
  const orderRef = params.order
    ? { order: params.order, item: params.item ?? '', partnerSlug: params.partnerSlug }
    : undefined

  // The front carries no QR and no per-card text, so it is rendered once for the
  // design rather than re-rendered every time the URL list is edited.
  useEffect(() => {
    let cancelled = false
    setFrontPreviewing(true)
    renderFrontPrintPreview(snapshot)
      .then((result) => {
        if (!cancelled) setFrontPreview(result)
      })
      .catch(() => {
        if (!cancelled) setFrontPreview(null)
      })
      .finally(() => {
        if (!cancelled) setFrontPreviewing(false)
      })

    return () => {
      cancelled = true
    }
  }, [snapshot])

  // Live preview of card 1's back, debounced — each render is a full offscreen
  // Fabric load, so it must not run per keystroke.
  const firstCardUrl = cardUrls[0] ?? null
  useEffect(() => {
    let cancelled = false
    setBackPreviewing(true)
    const timer = setTimeout(() => {
      renderBackPrintPreview(snapshot, firstCardUrl)
        .then((result) => {
          if (!cancelled) setBackPreview(result)
        })
        .catch(() => {
          if (!cancelled) setBackPreview(null)
        })
        .finally(() => {
          if (!cancelled) setBackPreviewing(false)
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [snapshot, firstCardUrl])

  const handleDownload = async () => {
    setExporting(true)
    setExportWarnings([])
    setExportError(null)
    try {
      const result = await exportPrintFiles(snapshot, { cardUrls, orderRef })
      triggerBlobDownload(result.blob, result.filename)
      setExportWarnings(result.warnings)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export print files')
    } finally {
      setExporting(false)
    }
  }

  // === Google Drive (PLAN-04) ===

  // The token is what authorises the upload and the write-back; without the full
  // set this is a manual session and the ZIP is the only way out.
  const canSaveToDrive = Boolean(params.order && params.item && params.token)
  const driveBusy = driveState === 'preparing' || driveState === 'uploading'

  /** Editing the list invalidates a finished or paused run — that bundle is stale. */
  const handleTextChange = (value: string) => {
    setText(value)
    if (driveBusy) return
    bundleRef.current = null
    setDriveState('idle')
    setDriveProgress(null)
    setDriveResult(null)
    setDriveError(null)
  }

  /**
   * `only` resumes a paused run: the same bundle, just the files that never
   * landed. Re-init is safe — the edge function finds the same folder and mints
   * update sessions.
   */
  const runDriveSave = async (only?: string[]) => {
    if (!params.order || !params.item || !params.token) return

    setDriveError(null)
    setDriveProgress(null)
    setDriveState('preparing')
    try {
      let bundle = bundleRef.current
      if (!bundle || !only) {
        // Same builder as the ZIP button, so Drive and the download can never
        // carry different files.
        const result = await exportPrintFiles(snapshot, { cardUrls, orderRef })
        setExportWarnings(result.warnings)
        bundle = {
          folderName: result.filename.replace(/\.zip$/, ''),
          files: result.files,
        }
        bundleRef.current = bundle
      }

      setDriveState('uploading')
      const saved = await saveBundleToDrive({
        context: {
          order: params.order,
          item: params.item,
          exp: params.exp,
          token: params.token,
          wpDomain: params.wpDomain,
        },
        folderName: bundle.folderName,
        files: bundle.files,
        only,
        onProgress: setDriveProgress,
      })
      // A resumed run only reports what *it* sent; the counts the operator reads
      // are about the whole bundle, so carry the earlier files forward.
      const alreadyUploaded = only ? (driveResult?.uploaded ?? []) : []
      setDriveResult({ ...saved, uploaded: [...alreadyUploaded, ...saved.uploaded] })
      setDriveState(saved.remaining.length > 0 ? 'paused' : 'done')
    } catch (err) {
      setDriveError({
        message: err instanceof Error ? err.message : 'Could not save to Google Drive',
        reauth: err instanceof DriveError && err.reauthRequired,
      })
      setDriveState('error')
    } finally {
      setDriveProgress(null)
    }
  }

  // Half-assigned QRs are only a warning for the ZIP, but these files go to the
  // supplier's folder — make the operator say so out loud.
  const handleDriveClick = () => {
    if (warnings.length > 0) setDriveState('confirm')
    else void runDriveSave()
  }

  /** The files are in Drive; only the order needs telling. Never re-uploads. */
  const handleRetryWriteBack = async () => {
    if (!driveResult || !params.order || !params.item || !params.token || !params.wpDomain) return
    setWriteBackRetrying(true)
    try {
      await postProductionLink(params.wpDomain, {
        order: params.order,
        item: params.item,
        exp: params.exp,
        token: params.token,
        drive_url: driveResult.folderUrl,
      })
      setDriveResult({ ...driveResult, writeBack: 'ok', writeBackError: undefined })
    } catch (err) {
      setDriveResult({
        ...driveResult,
        writeBack: 'failed',
        writeBackError: err instanceof Error ? err.message : 'The order could not be updated.',
      })
    } finally {
      setWriteBackRetrying(false)
    }
  }

  const handleCopyFolderUrl = async () => {
    if (!driveResult) return
    await navigator.clipboard.writeText(driveResult.folderUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // The card body behind a transparent print PNG, so a white-module QR on black PVC
  // is visible here rather than white-on-white. Engraved sides are opaque JPEGs and
  // cover it anyway.
  const variation = getVariation(snapshot.variationId ?? '')

  const frontCaption = frontPreview?.engraved
    ? 'Engraved artwork, black on white — one front.jpg for every card.'
    : 'Full colour on a transparent background — one front.png for every card.'

  return (
    <div className="max-w-4xl mx-auto rounded-xl border border-border bg-card p-5 space-y-5 text-left">
      {/* Heading + order context */}
      <div className="flex items-start gap-3">
        <Wrench className="size-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">Production</h2>
          <p className="text-xs text-muted-foreground">
            {params.order ? (
              <>
                Order #{params.order}
                {params.partnerSlug && <> &middot; {params.partnerSlug}</>}
                {' '}&middot;{' '}
                {params.cardUrls.length} QR {params.cardUrls.length === 1 ? 'code' : 'codes'} supplied
              </>
            ) : (
              'Paste one card URL per line, in card order — each becomes that card’s QR code.'
            )}
          </p>
        </div>
      </div>

      {legacyPrintedMetal && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">{LEGACY_PRINTED_METAL_NOTICE}</p>
        </div>
      )}

      {/* Both sides of the print file, side by side — the same renders the bundle
          carries, so one glance checks what the supplier actually receives. */}
      <div className="space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Print files
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <PrintFilePreview
            label="Front"
            alt="Front of card as it will print"
            cardImage={variation?.frontImage}
            preview={frontPreview}
            loading={frontPreviewing}
            caption={frontCaption}
          />
          <PrintFilePreview
            label={backCount > 1 ? `Back — card 1 of ${backCount}` : 'Back'}
            alt="Back of card with QR code"
            cardImage={variation?.backImage}
            preview={backPreview}
            loading={backPreviewing}
            caption={
              backPreview?.hasQr
                ? 'The QR sits where the placeholder was, at the size it will print.'
                : 'No QR for card 1 yet — the placeholder is left out of print files.'
            }
          />
        </div>
      </div>

      {/* Card URLs: the paste box, with what each line resolved to beside it. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
        <div className="space-y-2">
          <label
            htmlFor="production-card-urls"
            className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Card URLs
          </label>
          <textarea
            id="production-card-urls"
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            spellCheck={false}
            rows={7}
            placeholder="https://app.partner.com/r/ab12cd"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {assigned} of {backCount} {backCount === 1 ? 'card has' : 'cards have'} a QR
            </span>
            {snapshot.backOption === 'qr-only' && cardUrls.length > 1 && (
              <>
                {' '}&middot; this design has a single card row, so the number of URLs sets how
                many backs are printed.
              </>
            )}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Card assignments
          </p>
          {rows.length > 0 ? (
            <ul className="rounded-md border border-border bg-background/50 px-3 py-2 max-h-[10.5rem] overflow-y-auto space-y-1">
              {rows.map((row) => (
                <li key={row.index} className="flex items-start gap-2 text-[11px] leading-4">
                  {row.valid ? (
                    <Check className="size-3 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="size-3 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span
                    className={cn(
                      'font-mono truncate',
                      row.valid ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
                    )}
                    title={row.url}
                  >
                    {row.url}
                  </span>
                  {row.valid && row.ref && (
                    <span className="ml-auto shrink-0 text-muted-foreground/70">{row.ref}</span>
                  )}
                  {row.unused && (
                    <span className="ml-auto shrink-0 text-amber-700 dark:text-amber-400">unused</span>
                  )}
                  {!row.valid && (
                    <span className="ml-auto shrink-0 text-amber-700 dark:text-amber-400">
                      not a URL
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-4">
              <p className="text-[11px] leading-4 text-muted-foreground">
                Nothing assigned yet. Paste one card URL per line, in card order — each line
                becomes that card&rsquo;s QR code, and its ref is shown here.
              </p>
            </div>
          )}

          {params.invalid.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                {params.invalid.length}{' '}
                {params.invalid.length === 1 ? 'entry' : 'entries'} in the link could not be read as
                a URL and {params.invalid.length === 1 ? 'is' : 'are'} not assigned to any card:{' '}
                <span className="font-mono">{params.invalid.join(', ')}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-1">
          {warnings.map((warning, i) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* Only what the export found that the live list above does not already say. */}
      {exportWarnings.some((warning) => !warnings.includes(warning)) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-1">
          {exportWarnings.filter((warning) => !warnings.includes(warning)).map((warning, i) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      )}

      {exportError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive">{exportError}</p>
        </div>
      )}

      {/* Actions. "Save to Google Drive" only exists on a tokened link (PLAN-04);
          a manual session gets the ZIP and nothing else. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="gap-2" disabled={exporting} onClick={handleDownload}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
          {exporting ? 'Preparing files...' : 'Download Print Files'}
        </Button>

        {canSaveToDrive && (
          <Button
            variant="secondary"
            className="gap-2"
            disabled={driveBusy || exporting}
            onClick={handleDriveClick}
          >
            {driveBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CloudUpload className="size-4" />
            )}
            {driveState === 'preparing'
              ? 'Preparing files...'
              : driveState === 'uploading'
                ? 'Uploading...'
                : 'Save to Google Drive'}
          </Button>
        )}

        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <QrCode className="size-3.5" />
          {cardUrls.length === 0
            ? 'No QR codes yet — files will print without them.'
            : `${cardUrls.length} QR ${cardUrls.length === 1 ? 'code' : 'codes'} will be embedded.`}
        </span>
      </div>

      {/* Drive delivery status. Everything below is component-local — nothing here
          is written to the store, to Supabase, or back into the design. */}
      {canSaveToDrive && driveState === 'confirm' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            These production files still have warnings above. Uploading them puts them in the
            order’s Drive folder for the supplier to print.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void runDriveSave()}>
              Upload anyway
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDriveState('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canSaveToDrive && driveState === 'preparing' && (
        <p className="text-xs text-muted-foreground">Rendering print files…</p>
      )}

      {canSaveToDrive && driveState === 'uploading' && driveProgress && (
        <p className="text-xs text-muted-foreground">
          Uploading {fileLabel(driveProgress.name)}… {driveProgress.index}/{driveProgress.total}
        </p>
      )}

      {canSaveToDrive && driveState === 'paused' && driveResult && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Upload paused — {driveResult.uploadError}{' '}
            {driveResult.uploaded.length} of{' '}
            {driveResult.uploaded.length + driveResult.remaining.length} files are in Drive;{' '}
            {driveResult.remaining.length}{' '}
            {driveResult.remaining.length === 1 ? 'file is' : 'files are'} still to go. Nothing has
            been written to the order yet.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runDriveSave(driveResult.remaining)}
            >
              Retry remaining
            </Button>
            <a
              href={driveResult.folderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
            >
              <ExternalLink className="size-3" />
              Open Drive folder
            </a>
          </div>
        </div>
      )}

      {canSaveToDrive && driveState === 'done' && driveResult && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 space-y-2',
            // Only a genuine write-back *failure* is amber. A link that never asked
            // for one did its whole job, so it reads as success.
            driveResult.writeBack === 'failed'
              ? 'border-amber-500/30 bg-amber-500/10'
              : 'border-emerald-500/30 bg-emerald-500/10',
          )}
        >
          <p
            className={cn(
              'text-xs',
              driveResult.writeBack === 'failed'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {driveResult.uploaded.length}{' '}
            {driveResult.uploaded.length === 1 ? 'file' : 'files'} uploaded to Drive
            {driveResult.writeBack === 'ok' && <> &middot; Saved to order ✓</>}
            {driveResult.writeBack === 'skipped' && (
              <> &middot; copy the link below into the order’s proof links.</>
            )}
            {driveResult.writeBack === 'failed' && (
              <>
                {' '}&middot; Couldn’t save to the order — paste it into the order’s proof links
                manually.{driveResult.writeBackError ? ` (${driveResult.writeBackError})` : ''}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={driveResult.folderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2"
            >
              <ExternalLink className="size-3" />
              Open Drive folder
            </a>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={handleCopyFolderUrl}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {driveResult.writeBack === 'failed' && (
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                disabled={writeBackRetrying}
                onClick={() => void handleRetryWriteBack()}
              >
                {writeBackRetrying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Retry saving to order
              </Button>
            )}
          </div>
        </div>
      )}

      {canSaveToDrive && driveState === 'error' && driveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 space-y-1">
          <p className="text-xs text-destructive">{driveError.message}</p>
          {driveError.reauth && (
            <p className="text-xs text-destructive">
              Google Drive needs re-authorising: re-run the one-time setup in{' '}
              <span className="font-mono">{DRIVE_SETUP_DOC}</span> to issue a new refresh token,
              then try again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

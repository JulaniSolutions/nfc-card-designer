import JSZip from 'jszip'

/** An original upload referenced by the design, as stored on the canvas objects. */
export interface SourceFile {
  url: string
  name: string
}

/** One entry in an export bundle. `path` is relative to the bundle root. */
export interface BundleFile {
  path: string
  blob: Blob
}

/**
 * The original uploads behind a design's images, deduped by URL.
 *
 * `_originalAssetUrl` is the untouched upload and `_assetUrl` the compressed copy
 * actually drawn on the canvas — the original wins here because that is what a
 * printer wants. It is deliberately never swapped back into the canvas objects:
 * originals predate background removal and cropping, so rendering from them would
 * resurrect artwork the user removed.
 */
export function extractSourceFiles(frontJson: string | null, backJson: string | null): SourceFile[] {
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

/** Hand a blob to the browser as a download. */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Zip a set of bundle files, optionally nested under a single root folder so the
 * archive extracts into one tidy directory rather than scattering `print/` and
 * friends into whatever the supplier unzipped it in.
 */
export async function zipBundle(files: BundleFile[], rootFolder?: string): Promise<Blob> {
  const zip = new JSZip()
  const prefix = rootFolder ? `${rootFolder}/` : ''
  for (const file of files) {
    zip.file(`${prefix}${file.path}`, file.blob)
  }
  return zip.generateAsync({ type: 'blob' })
}

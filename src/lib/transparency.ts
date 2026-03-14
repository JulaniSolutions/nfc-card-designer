/**
 * Detect whether an image has a transparent background.
 * - JPEG files are always considered opaque (JPEGs can't have transparency)
 * - PNG/WebP files are sampled: if <1% of pixels are transparent, considered opaque
 * - Has a 2-second timeout — if detection takes too long, assumes transparent (no warning)
 */
export async function isImageOpaque(file: File): Promise<boolean> {
  // JPEGs are always opaque
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
    return true
  }

  // GIF/SVG — skip detection, assume transparent
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return false
  }

  // PNG/WebP — sample pixels
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000)

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          // Sample at reduced size for performance
          const maxSize = 256
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
          canvas.width = Math.round(img.width * scale)
          canvas.height = Math.round(img.height * scale)

          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const data = imageData.data
          const totalPixels = canvas.width * canvas.height
          let transparentPixels = 0

          // Check alpha channel (every 4th byte starting at index 3)
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 128) {
              transparentPixels++
            }
          }

          const transparentRatio = transparentPixels / totalPixels
          clearTimeout(timeout)
          // If less than 1% transparent, it's opaque
          resolve(transparentRatio < 0.01)
        } catch {
          clearTimeout(timeout)
          resolve(false)
        }
      }
      img.onerror = () => {
        clearTimeout(timeout)
        resolve(false)
      }
      img.src = e.target?.result as string
    }
    reader.onerror = () => {
      clearTimeout(timeout)
      resolve(false)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Check if an already-loaded image element has transparency.
 * Used for checking images already on the canvas.
 */
export function isImageElementOpaque(imgElement: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement('canvas')
    const maxSize = 256
    const scale = Math.min(maxSize / imgElement.naturalWidth, maxSize / imgElement.naturalHeight, 1)
    canvas.width = Math.round(imgElement.naturalWidth * scale)
    canvas.height = Math.round(imgElement.naturalHeight * scale)

    const ctx = canvas.getContext('2d')!
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const totalPixels = canvas.width * canvas.height
    let transparentPixels = 0

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) transparentPixels++
    }

    return (transparentPixels / totalPixels) < 0.01
  } catch {
    return false
  }
}

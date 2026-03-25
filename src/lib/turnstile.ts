const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

let scriptLoaded = false
let scriptFailed = false

/**
 * Load the Turnstile script if not already loaded.
 * Resolves even on failure so callers can gracefully degrade.
 */
export function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve()
  if (scriptFailed) return Promise.resolve()
  if (document.querySelector('script[src*="turnstile"]')) {
    scriptLoaded = true
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => {
      scriptLoaded = true
      resolve()
    }
    // Brave and other privacy browsers may silently block the script
    // without firing onerror — use a timeout as a fallback
    script.onerror = () => {
      scriptFailed = true
      resolve()
    }
    setTimeout(() => {
      if (!scriptLoaded) scriptFailed = true
      resolve()
    }, 5000)
    document.head.appendChild(script)
  })
}

/**
 * Check if Turnstile CAPTCHA is configured.
 */
export function isTurnstileEnabled(): boolean {
  return !!TURNSTILE_SITE_KEY
}

/**
 * Get the configured site key (for use by the widget component).
 */
export function getTurnstileSiteKey(): string | undefined {
  return TURNSTILE_SITE_KEY
}

/**
 * Get a reference to the Turnstile API on window (after script load).
 */
export function getTurnstileApi(): TurnstileApi | null {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null
}

/**
 * Get a Turnstile verification token via invisible widget.
 * Used for flows without a visible dialog (e.g. email sending, re-saves).
 * Returns null if Turnstile is not configured or can't load.
 */
export async function getTurnstileToken(): Promise<string | null> {
  if (!TURNSTILE_SITE_KEY) return null

  await loadTurnstileScript()

  const turnstile = getTurnstileApi()
  if (!turnstile) return null

  // Try up to 2 attempts with increasing timeout
  for (const timeout of [5000, 8000]) {
    const token = await attemptInvisibleToken(turnstile, TURNSTILE_SITE_KEY, timeout)
    if (token) return token
  }

  return null
}

function attemptInvisibleToken(
  turnstile: TurnstileApi,
  sitekey: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    // Position off-screen but not display:none so Turnstile can render
    container.style.position = 'fixed'
    container.style.top = '-9999px'
    container.style.left = '-9999px'
    document.body.appendChild(container)

    let resolved = false
    const cleanup = () => {
      if (container.parentNode) document.body.removeChild(container)
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve(null)
      }
    }, timeoutMs)

    turnstile.render(container, {
      sitekey,
      size: 'invisible',
      callback: (token: string) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          cleanup()
          resolve(token)
        }
      },
      'error-callback': () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          cleanup()
          resolve(null)
        }
      },
      'expired-callback': () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          cleanup()
          resolve(null)
        }
      },
    })
  })
}

export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      size?: 'invisible' | 'normal' | 'compact'
      callback?: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
    }
  ) => string
  remove: (widgetId: string) => void
}

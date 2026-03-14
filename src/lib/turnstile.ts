const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

let scriptLoaded = false

/**
 * Load the Turnstile script if not already loaded.
 */
function loadScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve()
  if (document.querySelector('script[src*="turnstile"]')) {
    scriptLoaded = true
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => {
      scriptLoaded = true
      resolve()
    }
    script.onerror = () => reject(new Error('Failed to load Turnstile script'))
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
 * Get a Turnstile verification token.
 * Uses invisible mode — no user interaction required unless challenged.
 * Returns null if Turnstile is not configured.
 */
export async function getTurnstileToken(): Promise<string | null> {
  if (!TURNSTILE_SITE_KEY) return null

  await loadScript()

  const turnstile = (window as unknown as { turnstile: TurnstileApi }).turnstile
  if (!turnstile) return null

  return new Promise((resolve) => {
    // Create a temporary container for the invisible widget
    const container = document.createElement('div')
    container.style.display = 'none'
    document.body.appendChild(container)

    turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      size: 'invisible',
      callback: (token: string) => {
        document.body.removeChild(container)
        resolve(token)
      },
      'error-callback': () => {
        document.body.removeChild(container)
        resolve(null)
      },
      'expired-callback': () => {
        document.body.removeChild(container)
        resolve(null)
      },
    })
  })
}

interface TurnstileApi {
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
}

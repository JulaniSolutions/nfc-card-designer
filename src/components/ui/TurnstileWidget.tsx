import { useEffect, useRef, useCallback } from 'react'
import {
  isTurnstileEnabled,
  getTurnstileSiteKey,
  getTurnstileApi,
  loadTurnstileScript,
} from '@/lib/turnstile'
import type { TurnstileApi } from '@/lib/turnstile'

interface TurnstileWidgetProps {
  onToken: (token: string) => void
  onError?: () => void
}

/**
 * Managed-mode Turnstile widget.
 * Auto-passes silently for most users; shows a challenge only when Cloudflare requires it.
 * Calls onError if the script can't load (ad blocker, etc.) so the parent can proceed without a token.
 */
export function TurnstileWidget({ onToken, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  const stableOnToken = useCallback(onToken, [onToken])
  const stableOnError = useCallback(() => onError?.(), [onError])

  useEffect(() => {
    mountedRef.current = true

    if (!isTurnstileEnabled()) {
      stableOnError()
      return
    }

    let turnstile: TurnstileApi | null = null

    loadTurnstileScript().then(() => {
      if (!mountedRef.current) return

      turnstile = getTurnstileApi()
      if (!turnstile || !containerRef.current) {
        stableOnError()
        return
      }

      const sitekey = getTurnstileSiteKey()!
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey,
        size: 'normal',
        callback: (token: string) => {
          if (mountedRef.current) stableOnToken(token)
        },
        'error-callback': () => {
          if (mountedRef.current) stableOnError()
        },
        'expired-callback': () => {
          if (mountedRef.current) stableOnError()
        },
      })
    })

    return () => {
      mountedRef.current = false
      if (widgetIdRef.current && turnstile) {
        try {
          turnstile.remove(widgetIdRef.current)
        } catch {
          // Widget may already be removed
        }
        widgetIdRef.current = null
      }
    }
  }, [stableOnToken, stableOnError])

  if (!isTurnstileEnabled()) return null

  return <div ref={containerRef} className="flex justify-center" />
}

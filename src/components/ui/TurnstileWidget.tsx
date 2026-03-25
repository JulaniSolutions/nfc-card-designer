import { useEffect, useRef } from 'react'
import {
  isTurnstileEnabled,
  getTurnstileSiteKey,
  getTurnstileApi,
  loadTurnstileScript,
} from '@/lib/turnstile'
import type { TurnstileApi } from '@/lib/turnstile'

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void
  onError?: () => void
}

const WIDGET_TIMEOUT_MS = 10_000

/**
 * Managed-mode Turnstile widget.
 * Auto-passes silently for most users; shows a challenge only when Cloudflare requires it.
 * Calls onError if the script can't load (ad blocker, etc.) so the parent can proceed without a token.
 */
export function TurnstileWidget({ onToken, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)

  // Keep refs current without triggering re-renders
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    let mounted = true
    let turnstile: TurnstileApi | null = null

    if (!isTurnstileEnabled()) {
      onErrorRef.current?.()
      return
    }

    // Timeout: if widget hasn't resolved after WIDGET_TIMEOUT_MS, let the user proceed without a token
    const timeout = setTimeout(() => {
      if (mounted) {
        onTokenRef.current(null)
        onErrorRef.current?.()
      }
    }, WIDGET_TIMEOUT_MS)

    loadTurnstileScript().then(() => {
      if (!mounted) return

      turnstile = getTurnstileApi()
      if (!turnstile || !containerRef.current) {
        clearTimeout(timeout)
        onErrorRef.current?.()
        return
      }

      const sitekey = getTurnstileSiteKey()!
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey,
        size: 'normal',
        callback: (token: string) => {
          if (mounted) {
            clearTimeout(timeout)
            onTokenRef.current(token)
          }
        },
        'error-callback': () => {
          if (mounted) {
            clearTimeout(timeout)
            onErrorRef.current?.()
          }
        },
        'expired-callback': () => {
          // Token expired — clear it so we don't send a stale token
          if (mounted) {
            onTokenRef.current(null)
            onErrorRef.current?.()
          }
        },
      })
    })

    return () => {
      mounted = false
      clearTimeout(timeout)
      if (widgetIdRef.current && turnstile) {
        try {
          turnstile.remove(widgetIdRef.current)
        } catch {
          // Widget may already be removed
        }
        widgetIdRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- runs once on mount, callbacks accessed via refs

  if (!isTurnstileEnabled()) return null

  return <div ref={containerRef} className="flex justify-center" />
}

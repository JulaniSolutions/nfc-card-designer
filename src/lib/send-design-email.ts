import { getTurnstileToken } from './turnstile'

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

export async function sendDesignEmail(
  toEmail: string,
  designUrl: string,
  designName?: string
): Promise<void> {
  const turnstileToken = await getTurnstileToken()

  const res = await fetch(getEdgeFunctionUrl('send-design-email'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      to_email: toEmail,
      design_url: designUrl,
      design_name: designName || undefined,
      turnstile_token: turnstileToken,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to send email' }))
    throw new Error(err.error || `Failed to send email (${res.status})`)
  }
}

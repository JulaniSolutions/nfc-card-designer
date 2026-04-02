import { isSupabaseConfigured } from './supabase'
import { fetchWithTimeout } from './fetch-with-timeout'

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

export interface UploadedAsset {
  url: string
  path: string
}

/** Upload the original file to Supabase Storage. Fails silently — never blocks the design flow. */
export async function uploadOriginalAsset(file: File): Promise<UploadedAsset | null> {
  if (!isSupabaseConfigured()) return null

  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetchWithTimeout(getEdgeFunctionUrl('upload-asset'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: formData,
    }, 45_000)

    if (!res.ok) return null

    const data = await res.json()
    return { url: data.url, path: data.path }
  } catch {
    return null
  }
}

/**
 * Fetch wrapper with AbortController-based timeout.
 * Aborts the actual HTTP request (not just the promise) so connections are freed.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

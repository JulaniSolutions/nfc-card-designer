#!/usr/bin/env node
/**
 * One-time Google Drive OAuth helper — prints a refresh token for the
 * `drive-upload` Supabase edge function (see scripts/google-drive-setup.md).
 *
 * Local only. Never deployed, never imported by the app. Node 20+, no npm deps.
 *
 * Usage:
 *   node scripts/get-google-refresh-token.mjs
 *   node scripts/get-google-refresh-token.mjs --client-id=… --client-secret=…
 *   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/get-google-refresh-token.mjs
 *
 * Credentials are read from flags, then env vars, then an interactive prompt.
 * Nothing is written to disk; the only secret printed is the final refresh token.
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'

const PORT = 8765
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 10 * 60 * 1000

// ── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw)
    if (!match) continue
    args[match[1]] = match[2] ?? 'true'
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help || args.h) {
  process.stdout.write(
    [
      'Get a Google refresh token for the drive-upload edge function.',
      '',
      'Usage:',
      '  node scripts/get-google-refresh-token.mjs [--client-id=…] [--client-secret=…]',
      '',
      'Credentials may also come from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,',
      'or from an interactive prompt if neither is set.',
      '',
      `The OAuth client must be a Web application with redirect URI ${REDIRECT_URI}`,
      'See scripts/google-drive-setup.md for the full walkthrough.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

// ── prompts ─────────────────────────────────────────────────────────────────

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true,
    })
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question)
      // Swallow the echo so the secret never appears in the terminal or in
      // scrollback; the prompt itself was already written above.
      rl._writeToOutput = () => {}
      rl.question('', (answer) => {
        process.stdout.write('\n')
        rl.close()
        resolve(answer.trim())
      })
      return
    }
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function resolveCredentials() {
  let clientId = args['client-id'] || process.env.GOOGLE_CLIENT_ID || ''
  let clientSecret = args['client-secret'] || process.env.GOOGLE_CLIENT_SECRET || ''

  if (!clientId) clientId = await prompt('Google OAuth client ID: ')
  if (!clientSecret) clientSecret = await prompt('Google OAuth client secret (hidden): ', { hidden: true })

  if (!clientId || !clientSecret) {
    fail(
      'Both a client ID and a client secret are required.\n' +
        'Create a Web application OAuth client in Google Cloud Console — see scripts/google-drive-setup.md step 1.',
    )
  }
  return { clientId, clientSecret }
}

// ── output helpers ──────────────────────────────────────────────────────────

function log(line = '') {
  process.stdout.write(`${line}\n`)
}

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n`)
  process.exit(1)
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #0b0b0c; color: #f4f4f5;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
  main { max-width: 30rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { color: #a1a1aa; line-height: 1.6; margin: 0; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`
}

// ── browser ─────────────────────────────────────────────────────────────────

function openBrowser(url) {
  const commands =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [['xdg-open', [url]]]
  for (const [command, commandArgs] of commands) {
    try {
      const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true })
      child.on('error', () => {}) // no browser available — the printed URL is the fallback
      child.unref()
      return true
    } catch {
      // ignore — non-fatal, the user can paste the URL themselves
    }
  }
  return false
}

// ── OAuth ───────────────────────────────────────────────────────────────────

function buildConsentUrl(clientId, state) {
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

async function exchangeCode(code, { clientId, clientSecret }) {
  let response
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
  } catch (error) {
    throw new Error(`Could not reach ${TOKEN_ENDPOINT}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    // non-JSON error body — surfaced raw below
  }

  if (!response.ok) {
    const detail = payload?.error_description || payload?.error || text.slice(0, 500)
    throw new Error(
      `Token exchange failed (HTTP ${response.status}): ${detail}\n` +
        '  · "redirect_uri_mismatch" → add http://localhost:8765/callback to the OAuth client\n' +
        '  · "invalid_client" → the client ID/secret pair does not match\n' +
        '  · "invalid_grant" → the code expired; just run the script again',
    )
  }

  if (!payload?.refresh_token) {
    throw new Error(
      'Google returned an access token but no refresh token.\n' +
        'Revoke the app under https://myaccount.google.com/permissions and run this script again\n' +
        '(it already requests access_type=offline and prompt=consent).',
    )
  }

  return payload.refresh_token
}

/**
 * Binds the localhost callback server.
 * Resolves once it is listening, with a promise for the authorisation code;
 * rejects if the port could not be bound at all.
 */
function startCallbackServer(state) {
  return new Promise((onListening, onListenError) => {
    let listening = false
    let settled = false
    let resolveCode = () => {}
    let rejectCode = () => {}
    const codePromise = new Promise((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    const resolve = (value) => finish(resolveCode, value)
    const reject = (value) => finish(rejectCode, value)
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close(() => fn(value))
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const send = (status, title, body) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page(title, body))
      }

      const error = url.searchParams.get('error')
      if (error) {
        send(400, 'Authorisation cancelled', 'Nothing was saved. Return to your terminal and run the script again.')
        reject(new Error(`Google returned an error: ${error}`))
        return
      }

      if (url.searchParams.get('state') !== state) {
        send(400, 'State mismatch', 'This callback did not come from the request this script started. Nothing was saved.')
        reject(new Error('State mismatch — possible CSRF, or a stale browser tab from an earlier run.'))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        send(400, 'No authorisation code', 'Google did not send a code. Return to your terminal and run the script again.')
        reject(new Error('Callback had neither a code nor an error parameter.'))
        return
      }

      send(200, 'Authorised ✓', 'You can close this tab — the refresh token is printed in your terminal.')
      resolve(code)
    })

    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${TIMEOUT_MS / 60000} minutes waiting for the Google callback.`))
    }, TIMEOUT_MS)
    timer.unref?.()

    server.on('error', (error) => {
      const wrapped =
        error?.code === 'EADDRINUSE'
          ? new Error(
              `Port ${PORT} is already in use.\n` +
                `Stop whatever is listening on it (macOS/Linux: lsof -ti tcp:${PORT} | xargs kill) and run the script again.\n` +
                `The port is fixed because it must match the OAuth client's redirect URI (${REDIRECT_URI}).`,
            )
          : error instanceof Error
            ? error
            : new Error(String(error))
      if (!listening) {
        clearTimeout(timer)
        onListenError(wrapped)
        return
      }
      reject(wrapped)
    })

    server.listen(PORT, '127.0.0.1', () => {
      listening = true
      // Wrapped in an object: resolving a promise *with* a promise would adopt
      // it, so `await startCallbackServer()` would block until the callback.
      onListening({ codePromise })
    })
  })
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const credentials = await resolveCredentials()
  const state = randomUUID()
  const consentUrl = buildConsentUrl(credentials.clientId, state)
  const { codePromise } = await startCallbackServer(state)

  log()
  log('Sign in as the Google account that owns the target My Drive (pawan@swftconnect.com).')
  log(`Scope requested: ${SCOPE} — the app can only ever see files and folders it creates.`)
  log()
  log('Open this URL if a browser window does not appear:')
  log()
  log(`  ${consentUrl}`)
  log()

  openBrowser(consentUrl)
  log(`Waiting for the callback on ${REDIRECT_URI} …`)

  const code = await codePromise
  log('Got the authorisation code — exchanging it for a refresh token …')
  const refreshToken = await exchangeCode(code, credentials)

  log()
  log('─'.repeat(72))
  log('GOOGLE_REFRESH_TOKEN')
  log()
  log(`  ${refreshToken}`)
  log()
  log('─'.repeat(72))
  log()
  log('This is printed once and never written to disk. Store it only as a Supabase')
  log('secret — do not commit it, paste it into chat, or keep it in a notes app.')
  log()
  log('Next step (fill in the other three values yourself):')
  log()
  log('  supabase secrets set \\')
  log('    GOOGLE_CLIENT_ID=<your client id> \\')
  log('    GOOGLE_CLIENT_SECRET=<your client secret> \\')
  log(`    GOOGLE_REFRESH_TOKEN=${refreshToken} \\`)
  log('    DESIGNER_SHARED_SECRET=<same value as the WordPress designer_shared_secret setting>')
  log()
  log('  supabase functions deploy drive-upload')
  log()
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})

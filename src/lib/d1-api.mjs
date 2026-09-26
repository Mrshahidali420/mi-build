/**
 * Read the analytics database from outside the Worker.
 *
 * The homepage planner runs in the deploy job, not in the Worker, so it has
 * no D1 binding. It asks Cloudflare's REST API instead, with the same token
 * the job already holds. api.cloudflare.com is not behind our own Bot Fight
 * Mode, which is why this works from CI while fetching manhwaindex.com does
 * not.
 *
 * The token needs Account > D1 > Read. CLOUDFLARE_D1_TOKEN wins when it is
 * set, so a separate read-only token can be added without touching the deploy
 * token.
 *
 * On a laptop the same questions can go through wrangler instead (it uses the
 * owner's own login): queryD1Wrangler.
 */
import { execFileSync } from 'node:child_process'

export const D1_DATABASE_ID = 'a31cde34-a594-4430-b415-79869e4f4435'
export const D1_DATABASE_NAME = 'manhwaindex-analytics'
const DEFAULT_ACCOUNT = '735d0fbab0757142b2c29917563e0626'
const TIMEOUT_MS = 30000

/** An error whose message is safe to write into the public decisions log. */
export class D1Error extends Error {}

/** Rows for one SELECT through the Cloudflare API. */
export async function queryD1(sql, params = [], env = process.env) {
  const token = env.CLOUDFLARE_D1_TOKEN || env.CLOUDFLARE_API_TOKEN
  if (!token) throw new D1Error('no Cloudflare token in the environment')
  const account = env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${D1_DATABASE_ID}/query`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new D1Error(`D1 unreachable: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`)
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    // Handled below: a body that is not JSON is a malformed answer.
  }
  if (res.status === 401 || res.status === 403) {
    throw new D1Error(`D1 answered ${res.status}: the token has no D1 read permission`)
  }
  if (!res.ok || !body || body.success === false) {
    const first = body?.errors?.[0]?.message || ''
    throw new D1Error(`D1 answered ${res.status}${first ? `: ${first.slice(0, 120)}` : ''}`)
  }
  const rows = body.result?.[0]?.results
  if (!Array.isArray(rows)) throw new D1Error('D1 answer had no rows array')
  return rows
}

/**
 * Put the parameters into the SQL text for wrangler, which takes no
 * parameters on the command line. Only numbers and our own day strings are
 * ever passed, and anything else is refused, so nothing typed by a visitor
 * can reach this.
 */
export function inlineParams(sql, params) {
  let i = 0
  const text = sql.replace(/\?/g, () => {
    const v = params[i++]
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'string' && /^[\w\-./: ]*$/.test(v)) return `'${v}'`
    throw new D1Error('a parameter wrangler cannot carry safely')
  })
  if (i !== params.length) throw new D1Error('parameter count does not match the SQL')
  return text.replace(/\s+/g, ' ').trim()
}

/** Rows for one SELECT through `wrangler d1 execute --remote`. Laptop only. */
export async function queryD1Wrangler(sql, params = []) {
  const text = inlineParams(sql, params)
  if (text.includes('"')) throw new D1Error('SQL for wrangler must not hold double quotes')
  let out
  try {
    out = execFileSync('npx', ['wrangler', 'd1', 'execute', D1_DATABASE_NAME, '--remote', '--json', '--command', `"${text}"`], {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    })
  } catch (error) {
    throw new D1Error(`wrangler failed: ${String(error.stderr || error.message).split('\n')[0].slice(0, 120)}`)
  }
  const start = out.indexOf('[')
  let body
  try {
    body = JSON.parse(out.slice(start))
  } catch {
    throw new D1Error('wrangler answer was not JSON')
  }
  const rows = body?.[0]?.results
  if (!Array.isArray(rows)) throw new D1Error('wrangler answer had no rows array')
  return rows
}

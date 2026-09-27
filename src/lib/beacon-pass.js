/**
 * The beacon's door rules, moved out of src/worker.js unchanged so they can
 * be tested without a Worker, and so each refusal can name its reason for
 * the refused-hits counter (src/lib/reject-count.js).
 *
 * Nothing here decides anything new: a body that is empty, too big or not
 * JSON is dropped, and a beacon without a live pass this Worker signed is
 * dropped, exactly as before. The only change is that the "no" now says why.
 */

// A row is small. Anything bigger than this is a mistake or an attack, and is
// dropped before it reaches the database.
export const MAX_BODY = 32768

const enc = new TextEncoder()

export async function sign(key, message) {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', k, enc.encode(message))
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Why a pass is no good, or null when it is one this Worker signed and it is
 * still alive. The pass is the minute it dies plus a signature, so it is
 * checked without keeping a list.
 */
export async function passProblem(pass, env, now = Date.now()) {
  if (!env || !env.PASS_KEY || typeof pass !== 'string' || !pass) return 'no_pass'
  const cut = pass.indexOf('.')
  if (cut < 1) return 'bad_pass'
  const dies = Number(pass.slice(0, cut))
  if (!dies) return 'bad_pass'
  if (dies < now) return 'old_pass'
  return pass.slice(cut + 1) === (await sign(env.PASS_KEY, String(dies))) ? null : 'bad_pass'
}

/** { body } for a beacon body worth looking at, or { reason } to drop it. */
export function readBeacon(raw) {
  if (!raw || raw.length > MAX_BODY) return { reason: 'bad_body' }
  let body
  try {
    body = JSON.parse(raw)
  } catch (e) {
    return { reason: 'bad_json' }
  }
  if (!body || typeof body !== 'object') return { reason: 'bad_json' }
  return { body }
}

/** The page type a beacon body says it came from (checked by the counter). */
export function beaconPlace(body) {
  const row = Array.isArray(body?.rows) ? body.rows[0] : body
  return row && typeof row === 'object' ? row.page_type : ''
}

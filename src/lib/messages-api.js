/**
 * The door the three reader forms write through: /_message, for feedback,
 * the contact form and sponsor requests. Answered by src/worker.js before
 * Astro is reached, like /_review, and checked the same way and in the same
 * order (src/lib/reviews-api.js):
 *   1. POST, same origin, a JSON body of at most 16 KB (opening).
 *   2. A strict body (checkMessage in src/lib/messages.mjs).
 *   3. A fresh Turnstile ticket.
 *   4. An address may send DAILY_MESSAGES a day, and when MAX_NEW messages
 *      already wait for the owner, new ones are paused.
 *
 * No IP address is kept. The daily limit uses an HMAC of the address and the
 * day under PASS_KEY, and the night job blanks it after two days
 * (forgetMessageSenders below).
 */
import { sign } from './beacon-pass.js'
import { answer, dayOf, ipOf, opening, verifyTicket } from './reviews-api.js'
import {
  checkMessage,
  MESSAGE_INSERT,
  MESSAGE_SENDS_READ,
  MESSAGES_NEW_COUNT,
  DAILY_MESSAGES,
  MAX_NEW,
  FORGET_MESSAGE_SENDERS,
} from './messages.mjs'

// A message is at most 3000 characters (up to 12 KB in UTF-8), plus the
// short fields and the ticket.
const MAX_MESSAGE_BODY = 16384
// How long a hash that spots repeats is kept, in days.
const FORGET_AFTER_DAYS = 2

const NOT_SAVED = 'Not sent just now. Try again later, or email hello@manhwaindex.com.'

/** One message from a form. Saved as 'new' for /my-admin/messages. */
export async function handleMessage(request, env, { now = Date.now(), verify = verifyTicket } = {}) {
  const open = await opening(request, env, MAX_MESSAGE_BODY)
  if (open.refused) return open.refused
  const { value: msg, error, field } = checkMessage(open.body)
  if (error) return answer(400, { ok: false, error, field })

  const ip = ipOf(request)
  if (!(await verify(msg.token, ip, env))) {
    return answer(403, { ok: false, error: 'The browser check did not pass. Reload the page and try again.' })
  }

  const day = dayOf(now)
  const at = new Date(now).toISOString()
  const sender = await sign(env.PASS_KEY, `message|${day}|${ip}`)
  const db = open.db
  try {
    const sent = await db.prepare(MESSAGE_SENDS_READ).bind(day, sender).first()
    if (Number(sent?.n) >= DAILY_MESSAGES) {
      return answer(429, {
        ok: false,
        error: `That is ${DAILY_MESSAGES} messages today. Thank you; write again tomorrow, or email hello@manhwaindex.com.`,
      })
    }
    const waiting = await db.prepare(MESSAGES_NEW_COUNT).first()
    if (Number(waiting?.n) >= MAX_NEW) {
      return answer(503, { ok: false, error: 'Messages are paused for a little while. Please email hello@manhwaindex.com instead.' })
    }
    await db
      .prepare(MESSAGE_INSERT)
      .bind(msg.kind, msg.name, msg.email, msg.topic, msg.page, msg.company, msg.website, msg.budget, msg.body, day, sender, at)
      .run()
  } catch {
    return answer(503, { ok: false, error: NOT_SAVED })
  }
  return answer(200, { ok: true, message: 'Thank you. Your message reached the site owner.' })
}

/**
 * The night job's part: blank the senders' hashes once they are two days
 * old. Run from the scheduled handler in src/worker.js. Never throws.
 */
export async function forgetMessageSenders(db, now = Date.now()) {
  if (!db) return
  const before = dayOf(now - FORGET_AFTER_DAYS * 86400000)
  try {
    await db.prepare(FORGET_MESSAGE_SENDERS).bind(before).run()
  } catch {
    // Before 0009 has run the table does not exist; the next night tries again.
  }
}

/**
 * Messages readers send to the owner: feedback from any page (/feedback),
 * the contact form (/contact) and sponsor or listing requests (/advertise).
 * Pure: no database, no clock, no fetch. Shared by the Worker
 * (src/lib/messages-api.js), the owner's tab (/my-admin/messages) and the
 * form in the reader's browser, which runs the very same check first.
 *
 * A message is private to the owner, so links are allowed: a dead-link report
 * or a sponsor's site needs one. Everything is kept as plain text and escaped
 * wherever it is drawn; HTML tags are refused outright.
 *
 * The table is in db/migrations/0009-messages.sql.
 */
import { cleanText, hasHtml, lengthOf } from './reviews.mjs'

export const MESSAGE_KINDS = ['feedback', 'contact', 'sponsor']

// The choices each form offers. The form draws these; the server accepts
// nothing else.
export const TOPICS = {
  feedback: ['Wrong or dead link', 'Missing title or platform', 'Something looks broken', 'Idea for the site', 'Something else'],
  contact: ['Wrong or dead link', 'Missing title or platform', 'Business or press', 'Something else'],
  sponsor: ['Sponsored spot', 'Paid listing', 'Partnership', 'Other'],
}
// Feedback may leave the topic and the email empty; the other two may not.
const TOPIC_REQUIRED = { feedback: false, contact: true, sponsor: true }
const EMAIL_REQUIRED = { feedback: false, contact: true, sponsor: true }

export const MIN_BODY = 10
export const MAX_BODY = 3000
export const MAX_NAME = 80
export const MAX_EMAIL = 200
export const MAX_PAGE = 300
export const MAX_COMPANY = 120
export const MAX_WEBSITE = 200
export const MAX_BUDGET = 60
// Messages one address may send in one day.
export const DAILY_MESSAGES = 5
// If this many messages are waiting, new ones are refused until the owner has
// read some. A flood can never fill the database or the tab.
export const MAX_NEW = 500

const MAX_TICKET = 2048
// A plain address: letters, digits and . _ % + - before the @, a dotted
// domain after it. Nothing that could leave a mailto: link.
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/

const COMMON_KEYS = ['kind', 'token', 'name', 'email', 'topic', 'body']
const KEYS = {
  feedback: new Set([...COMMON_KEYS, 'page']),
  contact: new Set(COMMON_KEYS),
  sponsor: new Set([...COMMON_KEYS, 'company', 'website', 'budget']),
}

/** One line of text: cleaned, new lines folded into spaces. */
export const oneLine = (value) => cleanText(value).replace(/\s+/g, ' ')

/**
 * A page path from ?page=, or '' when it is not one: it must start with "/",
 * hold no "//", no spaces and no control characters, and be short.
 */
export function cleanPage(value) {
  const page = String(value ?? '').trim()
  if (!page) return ''
  if (page.length > MAX_PAGE || page[0] !== '/' || page.includes('//') || page.includes('\\')) return null
  if (/[\s\u0000-\u001f\u007f-\u009f<>"']/.test(page)) return null
  return page
}

/** An http(s) address, '' when empty, or null when it is not one. */
export function cleanWebsite(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.length > MAX_WEBSITE || /[\s\u0000-\u001f\u007f-\u009f<>"']/.test(raw)) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) return null
  if (url.username || url.password) return null
  return raw
}

function ticketOf(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TICKET ? value : ''
}

/** A short one-line field: { value } or { error }. */
function shortField(body, key, max, label) {
  const raw = body[key]
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: `${label} must be text.` }
  const value = oneLine(raw || '')
  if (lengthOf(value) > max) return { error: `Keep ${label.toLowerCase()} under ${max} characters.` }
  if (hasHtml(value)) return { error: 'Plain text only, no HTML.' }
  return { value }
}

/**
 * Check one message's body. Returns { value } or { error, field }. The error
 * is written for the reader, because the form shows it as it is.
 */
export function checkMessage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be a JSON object' }
  const kind = body.kind
  if (!MESSAGE_KINDS.includes(kind)) return { error: 'unknown form' }
  for (const key of Object.keys(body)) if (!KEYS[kind].has(key)) return { error: `unknown field ${key.slice(0, 20)}` }

  const name = shortField(body, 'name', MAX_NAME, 'The name')
  if (name.error) return { ...name, field: 'name' }

  if (body.email !== undefined && typeof body.email !== 'string') return { error: 'The email must be text.', field: 'email' }
  const email = String(body.email || '').trim()
  if (!email && EMAIL_REQUIRED[kind]) return { error: 'Add your email, so the reply can reach you.', field: 'email' }
  if (email && (email.length > MAX_EMAIL || !EMAIL.test(email))) return { error: 'That email does not look right.', field: 'email' }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : body.topic
  if (topic === undefined || topic === null || topic === '') {
    if (TOPIC_REQUIRED[kind]) return { error: 'Choose what this is about.', field: 'topic' }
  } else if (!TOPICS[kind].includes(topic)) {
    return { error: 'Choose one of the options.', field: 'topic' }
  }

  let page = ''
  if (kind === 'feedback') {
    if (body.page !== undefined && typeof body.page !== 'string') return { error: 'The page must be text.', field: 'page' }
    page = cleanPage(body.page)
    if (page === null) return { error: 'The page must be an address on this site, starting with /.', field: 'page' }
  }

  let company = ''
  let website = ''
  let budget = ''
  if (kind === 'sponsor') {
    const c = shortField(body, 'company', MAX_COMPANY, 'The company or project')
    if (c.error) return { ...c, field: 'company' }
    company = c.value
    if (body.website !== undefined && typeof body.website !== 'string') return { error: 'The website must be text.', field: 'website' }
    website = cleanWebsite(body.website)
    if (website === null) return { error: 'The website must be a full address starting with https://', field: 'website' }
    const b = shortField(body, 'budget', MAX_BUDGET, 'The budget')
    if (b.error) return { ...b, field: 'budget' }
    budget = b.value
  }

  if (typeof body.body !== 'string') return { error: 'Write your message first.', field: 'body' }
  const text = cleanText(body.body)
  const n = lengthOf(text)
  if (n < MIN_BODY) return { error: `A few more words, please: at least ${MIN_BODY} characters.`, field: 'body' }
  if (n > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.`, field: 'body' }
  if (hasHtml(text)) return { error: 'Plain text only, no HTML.', field: 'body' }

  const token = ticketOf(body.token)
  if (!token) return { error: 'the browser check is missing' }
  return {
    value: { kind, name: name.value, email, topic: topic || '', page, company, website, budget, body: text, token },
  }
}

// -------------------------------------------------------------------- SQL

export const MESSAGE_INSERT = `INSERT INTO messages (kind, name, email, topic, page, company, website, budget, body, status, day, sender, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
export const MESSAGE_SENDS_READ = 'SELECT COUNT(*) AS n FROM messages WHERE day = ? AND sender = ?'
export const MESSAGES_NEW_COUNT = "SELECT COUNT(*) AS n FROM messages WHERE status = 'new'"
export const MESSAGES_NEW_BY_KIND = "SELECT kind, COUNT(*) AS n FROM messages WHERE status = 'new' GROUP BY kind"
const LIST_COLUMNS = 'id, kind, name, email, topic, page, company, website, budget, body, status, created_at'
export const MESSAGES_NEW_LIST = `SELECT ${LIST_COLUMNS} FROM messages WHERE status = 'new'
  ORDER BY created_at DESC, id DESC LIMIT 200`
export const MESSAGES_KIND_LIST = `SELECT ${LIST_COLUMNS} FROM messages WHERE status = 'new' AND kind = ?
  ORDER BY created_at DESC, id DESC LIMIT 200`
export const MESSAGES_DONE_LIST = `SELECT ${LIST_COLUMNS} FROM messages WHERE status = 'done'
  ORDER BY created_at DESC, id DESC LIMIT 200`
export const MESSAGE_DONE = "UPDATE messages SET status = 'done' WHERE id = ? AND status = 'new'"
export const MESSAGE_DELETE = 'DELETE FROM messages WHERE id = ?'
export const MESSAGE_FIND = 'SELECT id, kind, topic, status FROM messages WHERE id = ?'
// The night job: the hashes stop being useful after a day, so they go.
export const FORGET_MESSAGE_SENDERS = 'UPDATE messages SET sender = NULL WHERE day < ? AND sender IS NOT NULL'

// ------------------------------------------------------- the owner's buttons

export const MESSAGE_OPS = ['done', 'delete']
const TAP_KEYS = new Set(['op', 'id'])

/** Check one tap from /my-admin/messages. Returns { value } or { error }. */
export function checkMessageTap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be a JSON object' }
  for (const key of Object.keys(body)) if (!TAP_KEYS.has(key)) return { error: `unknown field ${key.slice(0, 20)}` }
  if (!MESSAGE_OPS.includes(body.op)) return { error: 'op must be done or delete' }
  if (!Number.isSafeInteger(body.id) || body.id <= 0) return { error: 'id must be a positive whole number' }
  return { value: { op: body.op, id: body.id } }
}

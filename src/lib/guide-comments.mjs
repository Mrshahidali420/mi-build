/**
 * Reader comments on the guides (/guides/<slug>), with one level of replies.
 * Pure: no database, no clock, no fetch. Shared by the Worker
 * (src/lib/guide-comments-api.js), the owner's tab (/my-admin/comments) and
 * the form in the reader's browser, which runs the very same check first.
 *
 * The rules are the title-page reviews' rules (src/lib/reviews.mjs), reused
 * as they are: no links, web addresses, site names, e-mail addresses,
 * @handles or HTML, and the same spam check. A comment that breaks one is
 * refused, never cleaned up and saved.
 *
 * Replies: a comment may answer an approved comment on the same guide
 * (parent_id). The page shows one level: a reply to a reply sits under the
 * top-level comment, with "replying to <name>" (threadComments below).
 *
 * The table is in db/migrations/0010-guide-comments.sql.
 */
import { cleanText, hasHtml, lengthOf, linkProblem, linkMessage, spamProblem } from './reviews.mjs'

export const MIN_COMMENT = 2
export const MAX_COMMENT = 1500
export const MAX_COMMENT_NAME = 40
// Comments one address may send in one day.
export const DAILY_COMMENTS = 10
// If more than this many comments wait for the owner, new ones are paused
// until some are read. A flood can never fill the database or the tab.
export const MAX_PENDING_COMMENTS = 500
// The most approved comments one guide sends to its page.
export const SHOW_COMMENTS = 500

const MAX_TICKET = 2048
// A guide's address: the same shape as every slug on the site.
export const GUIDE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/
const KEYS = new Set(['guide', 'parent', 'name', 'body', 'token'])

function ticketOf(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TICKET ? value : ''
}

/** The parent id: null for a top-level comment, a positive id, or undefined when bad. */
function parentOf(value) {
  if (value === undefined || value === null || value === '' || value === 0) return null
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/**
 * Check one comment's body. Returns { value } or { error, field }. The error
 * is written for the reader, because the form shows it as it is.
 */
export function checkComment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be a JSON object' }
  for (const key of Object.keys(body)) if (!KEYS.has(key)) return { error: `unknown field ${key.slice(0, 20)}` }
  if (typeof body.guide !== 'string' || !GUIDE_SLUG.test(body.guide)) return { error: 'unknown guide' }
  const parent = parentOf(body.parent)
  if (parent === undefined) return { error: 'unknown comment to reply to' }

  if (body.name !== undefined && typeof body.name !== 'string') return { error: 'The name must be text.', field: 'name' }
  const name = cleanText(body.name || '').replace(/\s+/g, ' ')
  if (!name) return { error: 'Add your name.', field: 'name' }
  if (lengthOf(name) > MAX_COMMENT_NAME) return { error: `Keep the name under ${MAX_COMMENT_NAME} characters.`, field: 'name' }
  if (hasHtml(name) || linkProblem(name)) return { error: 'The name cannot hold a link, an address or a handle.', field: 'name' }

  if (typeof body.body !== 'string') return { error: 'Write your comment first.', field: 'body' }
  const text = cleanText(body.body)
  const n = lengthOf(text)
  if (n < MIN_COMMENT) return { error: 'Write your comment first.', field: 'body' }
  if (n > MAX_COMMENT) return { error: `Keep it under ${MAX_COMMENT} characters.`, field: 'body' }
  if (hasHtml(text)) return { error: 'Plain text only, no HTML.', field: 'body' }
  const link = linkProblem(text)
  if (link) return { error: linkMessage(link), field: 'body' }
  const spam = spamProblem(text)
  if (spam) return { error: spam, field: 'body' }

  const token = ticketOf(body.token)
  if (!token) return { error: 'the browser check is missing' }
  return { value: { guide: body.guide, parent, name, body: text, token } }
}

/**
 * Approved rows ({ id, parent_id, name, body, created_at }, any order) as the
 * page shows them: top-level comments oldest first, each with its replies
 * oldest first. A reply to a reply sits under the top-level comment it
 * descends from, with `to` naming the comment it answered. A reply whose
 * top-level comment is gone is left out.
 */
export function threadComments(rows = []) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const order = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id
  const rootOf = (row) => {
    let at = row
    for (let hops = 0; at && at.parent_id && hops < 50; hops++) at = byId.get(at.parent_id)
    return at && !at.parent_id ? at : null
  }
  const plain = (r) => ({ id: r.id, name: r.name, body: r.body, created_at: r.created_at })
  const tops = rows.filter((r) => !r.parent_id).sort(order).map((r) => ({ ...plain(r), replies: [] }))
  const topById = new Map(tops.map((t) => [t.id, t]))
  for (const reply of rows.filter((r) => r.parent_id).sort(order)) {
    const root = rootOf(reply)
    const top = root ? topById.get(root.id) : null
    if (!top) continue
    const parent = byId.get(reply.parent_id)
    top.replies.push({ ...plain(reply), to: parent && parent.id !== top.id ? parent.name : null })
  }
  return tops
}

/** How many comments a thread holds, replies included. */
export const commentCount = (thread = []) => thread.reduce((n, top) => n + 1 + top.replies.length, 0)

// -------------------------------------------------------------------- SQL

export const COMMENT_INSERT = `INSERT INTO guide_comments (guide, parent_id, name, body, status, day, sender, created_at)
  VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
export const COMMENT_SENDS_READ = 'SELECT COUNT(*) AS n FROM guide_comments WHERE day = ? AND sender = ?'
export const COMMENTS_PENDING_COUNT = "SELECT COUNT(*) AS n FROM guide_comments WHERE status = 'pending'"
export const COMMENT_PARENT_READ = 'SELECT id, guide, status FROM guide_comments WHERE id = ?'
export const COMMENTS_APPROVED_READ = `SELECT id, parent_id, name, body, created_at FROM guide_comments
  WHERE guide = ? AND status = 'approved' ORDER BY created_at, id LIMIT ${SHOW_COMMENTS}`
const ADMIN_COLUMNS = `c.id, c.guide, c.parent_id, c.name, c.body, c.status, c.created_at, c.approved_at,
  p.name AS parent_name, substr(p.body, 1, 160) AS parent_body`
export const COMMENTS_PENDING_LIST = `SELECT ${ADMIN_COLUMNS} FROM guide_comments c
  LEFT JOIN guide_comments p ON p.id = c.parent_id
  WHERE c.status = 'pending' ORDER BY c.created_at DESC, c.id DESC LIMIT 200`
export const COMMENTS_APPROVED_LIST = `SELECT ${ADMIN_COLUMNS} FROM guide_comments c
  LEFT JOIN guide_comments p ON p.id = c.parent_id
  WHERE c.status = 'approved' ORDER BY c.approved_at DESC, c.id DESC LIMIT 200`
export const COMMENT_FIND = 'SELECT id, guide, status FROM guide_comments WHERE id = ?'
export const COMMENT_APPROVE = "UPDATE guide_comments SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'"
// A comment goes with every reply under it, at any depth, so no reply is left
// pointing at nothing.
export const COMMENT_DELETE = `DELETE FROM guide_comments WHERE id IN (
  WITH RECURSIVE thread(id) AS (
    SELECT ? UNION ALL SELECT c.id FROM guide_comments c JOIN thread t ON c.parent_id = t.id)
  SELECT id FROM thread)`
// The night job: the hashes stop being useful after a day, so they go.
export const FORGET_COMMENT_SENDERS = 'UPDATE guide_comments SET sender = NULL WHERE day < ? AND sender IS NOT NULL'

// ------------------------------------------------------- the owner's buttons

export const COMMENT_OPS = ['approve', 'delete']
const TAP_KEYS = new Set(['op', 'id'])

/** Check one tap from /my-admin/comments. Returns { value } or { error }. */
export function checkCommentTap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'the body must be a JSON object' }
  for (const key of Object.keys(body)) if (!TAP_KEYS.has(key)) return { error: `unknown field ${key.slice(0, 20)}` }
  if (!COMMENT_OPS.includes(body.op)) return { error: 'op must be approve or delete' }
  if (!Number.isSafeInteger(body.id) || body.id <= 0) return { error: 'id must be a positive whole number' }
  return { value: { op: body.op, id: body.id } }
}

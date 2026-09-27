/**
 * The Bots card on /my-admin/health: real people per day next to the hits
 * the door refused, why they were refused, and from where. The refused
 * counts come from daily_rejects (src/lib/reject-count.js); people come from
 * the night job's daily_totals, and today from the raw rows.
 */
import { ask, askOne, dayKey } from './admin.js'
import { REASONS, LET_IN } from './reject-count.js'
import { median } from './home-plan.mjs'

export const BOT_DAYS = 14
// A jump is worth a word when the day's refused hits are this many times the
// usual day, and at least this many: 10 refused against a usual 2 is noise.
export const JUMP_TIMES = 3
export const JUMP_MIN = 200

/** Words for a reason code, or the code itself for one this build does not know. */
export const reasonWords = (reason) => REASONS[reason] || reason

/**
 * The hint under the card: a day whose refused hits jumped well past the
 * usual (the median of the days before it). `days` is oldest first,
 * [{ day, rejected }], today last. Null when nothing stands out.
 */
export function botJumpHint(days) {
  const list = (days || []).filter((d) => d && typeof d.rejected === 'number')
  if (list.length < 2) return null
  const lastTwo = list.slice(-2).reverse()
  for (const d of lastTwo) {
    const before = list.filter((x) => x.day < d.day).slice(-7).map((x) => x.rejected)
    if (!before.length) continue
    const usual = median(before)
    if (d.rejected >= JUMP_MIN && d.rejected >= JUMP_TIMES * Math.max(usual, 1)) {
      return {
        level: 'act',
        text: `Refused hits jumped to ${d.rejected.toLocaleString('en-US')} on ${d.day}, about ${Math.round(d.rejected / Math.max(usual, 1))}x the usual ${Math.round(usual)}. Possibly a robot attack. None of it was counted as readers. If it keeps up, look at Cloudflare, Security, Events for this site.`,
      }
    }
  }
  return null
}

/**
 * Everything the card draws, in one go: per day people and refused (oldest
 * first, today last), refused by reason and by country over the last 7
 * days, and the share refused. Before 0005 is applied the table is missing,
 * ask() answers empty, and the card says there is nothing yet.
 */
export async function botsFor(db, now = Date.now()) {
  const today = dayKey(0, now)
  const from = dayKey(BOT_DAYS - 1, now)
  const from7 = dayKey(6, now)
  const letIn = [...LET_IN]
  const notIn = `reason NOT IN (${letIn.map(() => '?').join(',')})`
  const [perDay, people, peopleToday, reasons, countries] = await Promise.all([
    ask(
      db,
      `SELECT day, SUM(CASE WHEN ${notIn} THEN n ELSE 0 END) AS rejected, SUM(CASE WHEN reason = 'ok' THEN n ELSE 0 END) AS ok
       FROM daily_rejects WHERE day >= ? GROUP BY day`,
      ...letIn,
      from
    ),
    ask(db, 'SELECT day, people FROM daily_totals WHERE day >= ? AND day < ?', from, today),
    askOne(
      db,
      `SELECT COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END) AS people FROM events WHERE day = ? AND kind = 'view'`,
      today
    ),
    ask(
      db,
      `SELECT reason, SUM(n) AS n FROM daily_rejects WHERE day >= ? GROUP BY reason ORDER BY n DESC`,
      from7
    ),
    ask(
      db,
      `SELECT country, SUM(n) AS n FROM daily_rejects WHERE day >= ? AND ${notIn}
       GROUP BY country ORDER BY n DESC LIMIT 10`,
      from7,
      ...letIn
    ),
  ])
  const rejectedOf = new Map(perDay.map((r) => [r.day, r.rejected || 0]))
  const peopleOf = new Map(people.map((r) => [r.day, r.people || 0]))
  peopleOf.set(today, peopleToday.people || 0)
  const days = []
  for (let back = BOT_DAYS - 1; back >= 0; back -= 1) {
    const day = dayKey(back, now)
    days.push({ day, people: peopleOf.get(day) || 0, rejected: rejectedOf.get(day) || 0 })
  }
  const refused = reasons.filter((r) => !LET_IN.has(r.reason))
  const refused7 = refused.reduce((n, r) => n + (r.n || 0), 0)
  const let7 = reasons.filter((r) => r.reason === 'ok').reduce((n, r) => n + (r.n || 0), 0)
  return {
    days,
    reasons: refused,
    countries,
    refused7,
    share7: refused7 + let7 ? refused7 / (refused7 + let7) : 0,
    hasData: perDay.length > 0,
  }
}

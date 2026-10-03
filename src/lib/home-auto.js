// BUILD TIME ONLY. Reads data/home-auto.json, the plan scripts/plan-home.mjs
// writes each night, for the homepage.
//
// Read with readFileSync and a try, not a JSON import: a torn or missing
// plan file must never break the build. Without a plan the homepage simply
// has no self-updating sections and is otherwise exactly as before.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SECTIONS, BADGE_MAX } from './home-plan.mjs'

/** The plan, or null when the file is missing or not a plan. */
export function loadHomeAuto(file = join(process.cwd(), 'data', 'home-auto.json')) {
  try {
    const plan = JSON.parse(readFileSync(file, 'utf8'))
    if (!plan || typeof plan !== 'object' || typeof plan.night !== 'string' || typeof plan.sections !== 'object') return null
    return plan
  } catch {
    return null
  }
}

/**
 * One section's titles, ready for CoverGrid, or null when it is not drawn.
 *
 * Every id is looked up in today's catalog, so a title removed or blocked
 * since the plan was made just drops out, and covers and addresses are
 * always today's. A title already somewhere else on the homepage is dropped
 * too (a cover is never shown twice). If that leaves fewer than the
 * section's floor, the section is not drawn at all.
 *
 * `keep(item)` is a section's own test on today's record (Hot this week keeps
 * only titles with an official link). Each title it turns away is replaced by
 * the planner's next pick for that section (plan.next), so the shelf keeps
 * the size the plan gave it.
 */
export function homeShelf(plan, key, { lookup, onPage = new Set(), keep = null }) {
  const section = plan?.sections?.[key]
  const cfg = SECTIONS[key]
  if (!section || !cfg || section.enabled !== true || !Array.isArray(section.items)) return null
  const items = []
  const seen = new Set()
  let turnedAway = 0
  const take = (it) => {
    const id = Number(it?.id)
    if (!Number.isInteger(id) || seen.has(id) || onPage.has(id)) return
    const found = lookup(id)
    if (!found) return
    seen.add(id)
    if (keep && !keep(found.item)) {
      turnedAway += 1
      return
    }
    // The planner's one-line badge ("Saved by 14 readers this week") rides
    // on a copy of the record, so the catalog's own object is never touched.
    const badge = typeof it.badge === 'string' && it.badge.length <= BADGE_MAX ? it.badge : ''
    items.push(badge ? { ...found.item, badge } : found.item)
  }
  for (const it of section.items) {
    if (items.length >= cfg.slots) break
    take(it)
  }
  // Only a title the section's own test turned away is replaced, so the
  // shelf is never longer than the plan made it.
  const next = keep && Array.isArray(plan.next?.[key]) ? plan.next[key] : []
  const target = Math.min(cfg.slots, items.length + turnedAway)
  for (const it of next) {
    if (items.length >= target) break
    take(it)
  }
  if (items.length < cfg.floor) return null
  return { key, title: section.title || cfg.title, why: section.why || cfg.why, items }
}

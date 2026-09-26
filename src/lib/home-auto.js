// BUILD TIME ONLY. Reads data/home-auto.json, the plan scripts/plan-home.mjs
// writes each night, for the homepage.
//
// Read with readFileSync and a try, not a JSON import: a torn or missing
// plan file must never break the build. Without a plan the homepage simply
// has no self-updating sections and is otherwise exactly as before.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SECTIONS } from './home-plan.mjs'

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
 */
export function homeShelf(plan, key, { lookup, onPage = new Set() }) {
  const section = plan?.sections?.[key]
  const cfg = SECTIONS[key]
  if (!section || !cfg || section.enabled !== true || !Array.isArray(section.items)) return null
  const items = []
  const seen = new Set()
  for (const it of section.items) {
    const id = Number(it?.id)
    if (!Number.isInteger(id) || seen.has(id) || onPage.has(id)) continue
    const found = lookup(id)
    if (!found) continue
    seen.add(id)
    items.push(found.item)
    if (items.length >= cfg.slots) break
  }
  if (items.length < cfg.floor) return null
  return { key, title: section.title || cfg.title, why: section.why || cfg.why, items }
}

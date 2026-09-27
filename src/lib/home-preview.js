/**
 * Tomorrow's homepage, as far as tonight's plan already knows it.
 *
 * The planner cannot be run ahead of time (it needs tomorrow's closed day),
 * so this only says what the rules already decide: which titles reach their
 * longest stay and leave, which stay, and which of tonight's "would be next"
 * titles take the slots that free up, within the nightly limits. The words
 * on the tab say "if the numbers hold", because a title can still fall under
 * a floor or be passed by a new one overnight.
 *
 * Pure: the plan object in, a list per section out.
 */
import { SECTIONS, PRIORITY, PAGE_CHANGE_CAP } from './home-plan.mjs'

/**
 * { key, title, enabledTomorrow, stays, leaves, joins } per section, in the
 * planner's order. Each title is { id, path, title, badge }.
 */
export function tomorrowOf(plan) {
  let pageChanges = 0
  const out = []
  for (const key of PRIORITY) {
    const cfg = SECTIONS[key]
    const section = plan?.sections?.[key]
    if (!cfg || !section) continue
    const items = Array.isArray(section.items) ? section.items : []
    const leaving = (it) => !it.pinned && (Number(it.nights) || 0) >= cfg.maxStay
    const stays = items.filter((it) => !leaving(it))
    const leaves = items.filter(leaving)
    const room = Math.max(0, cfg.slots - stays.length)
    const allowed = Math.max(0, Math.min(room, cfg.cap, PAGE_CHANGE_CAP - pageChanges))
    // A title leaving tonight cools down, so it never re-joins the next day.
    const gone = new Set(leaves.map((it) => it.id))
    const joins = (plan?.next?.[key] || []).filter((it) => !gone.has(it.id)).slice(0, allowed)
    pageChanges += joins.length
    const pick = ({ id, path, title, badge }) => ({ id, path, title, badge: badge || '' })
    out.push({
      key,
      title: section.title || cfg.title,
      enabledTomorrow: stays.length + joins.length >= cfg.floor,
      stays: stays.map(pick),
      leaves: leaves.map(pick),
      joins: joins.map(pick),
    })
  }
  return out
}


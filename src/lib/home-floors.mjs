/**
 * The people floors of the homepage shelves, scaled to the site's traffic
 * (owner's call, 27 Sep 2026). Pure: the traffic and the ceilings are passed in.
 *
 * The fixed floors (20 people a week for Rising and New, 10 savers, 60 people
 * a month, 10 search arrivals) were set for a bigger site. At about 15,000 page
 * views a month no title reaches them, so the shelves stayed hidden. Now each
 * floor is a share of the site's own traffic over the same window:
 *
 *   floor = clamp(round(share x traffic), min, ceiling)
 *
 * traffic: people summed day by day over the window (daily_totals.people), the
 * same per-day count a title's people7 / people30 are made of, so the floor is
 * "this share of everyone who came". savers7 and the search counts are true
 * distinct people, a little lower than per-day sums, which errs on the strict side.
 * ceiling: the old fixed value, so a floor rises as the site grows and never
 * goes past what it was. min: never fewer than 3 different people, whatever
 * the traffic, so one or two readers can never fill a shelf.
 *
 * The shares, picked against the traffic on 26 Sep 2026 (2,014 people-days in
 * the week, 4,552 in the 15 days the month window then held):
 *   people7     0.45%  -> 9    Rising and New and noticed (ceiling 20 from ~4,450 a week)
 *   savers7     0.25%  -> 5    Readers are saving (ceiling 10 from ~4,000 a week)
 *   people30    0.33%  -> 15   Most opened this month (ceiling 60 from ~18,000 a month)
 *   webPeople7  0.30%  -> 6    Hot this week, from search engines (ceiling 10)
 *   sitePeople7 0.15%  -> 3    Hot this week, from our own search box (ceiling 5)
 * and the opens minimums, same clamp (the old values are the ceilings):
 *   risingOpens7 0.67% -> 13   Rising, opens this week (ceiling 30)
 *   risingSpike7 1.34% -> 27   Rising, a spike yesterday (ceiling 60)
 *   newOpens7    0.67% -> 13   New and noticed (ceiling 30)
 *   monthOpens30 0.82% -> 37   Most opened this month (ceiling 150)
 * A floor is only ever compared with "at least", so a lower floor lets in
 * every title a higher one did (tests/home-floors.test.js checks that).
 * The month window is compared with the month's own traffic, so while the
 * counter holds fewer than 30 days both sides are short by the same days.
 *
 * Every other brake (3 days of 7, one-visitor share, the adult filter, blocks,
 * bans and pins, one shelf per title, the nightly change cap, minimum stays,
 * cooldowns, a shelf's minimum size) is untouched.
 */

export const MIN_PEOPLE = 3

// Which traffic window each floor is a share of.
export const SCALE = {
  people7: { share: 0.0045, win: 7 },
  savers7: { share: 0.0025, win: 7 },
  people30: { share: 0.0033, win: 30 },
  webPeople7: { share: 0.003, win: 7 },
  sitePeople7: { share: 0.0015, win: 7 },
  // The opens minimums keep their old ratio to the people floor: Rising and
  // New asked 30 opens for 20 people (1.5x), the spike 60 (3x), the month 150
  // for 60 people (2.5x).
  risingOpens7: { share: 0.0067, win: 7 },
  risingSpike7: { share: 0.0134, win: 7 },
  newOpens7: { share: 0.0067, win: 7 },
  monthOpens30: { share: 0.0082, win: 30 },
}

// The floor each shelf is held to, for the plan file and /my-admin.
export const SECTION_FLOOR = {
  rising: 'people7',
  saving: 'savers7',
  new: 'people7',
  month: 'people30',
  searching: 'webPeople7',
}

const known = (n) => Number.isFinite(n) && n > 0

/** One floor: its share of the traffic, no lower than min, no higher than ceiling. */
export function scaleFloor(traffic, share, ceiling, min = MIN_PEOPLE) {
  if (!known(traffic)) return ceiling
  const low = Math.min(min, ceiling)
  return Math.max(low, Math.min(ceiling, Math.round(share * traffic)))
}

/**
 * Tonight's people floors. traffic = { people7, people30 } (site-wide, per-day
 * people summed), or null when it could not be read: then every floor stays at
 * its ceiling, the old fixed value, because an unknown site is not a small one.
 * ceilings: one per key of SCALE, the old fixed values.
 */
export function scaledFloors(traffic, ceilings) {
  // Half an answer is no answer: both windows or neither.
  const whole = known(Number(traffic?.people7)) && known(Number(traffic?.people30))
  const out = {}
  for (const [key, { share, win }] of Object.entries(SCALE)) {
    const t = !whole ? NaN : Number(win === 30 ? traffic.people30 : traffic.people7)
    out[key] = scaleFloor(t, share, ceilings[key])
  }
  return out
}

/** The line for the decisions log, short enough for the 119-character reason. */
export function floorsLine(traffic, f) {
  const t = known(Number(traffic?.people7))
    ? `${traffic.people7} people this week, ${traffic.people30} this month`
    : 'traffic unknown, fixed floors'
  return `${t}: rising/new ${f.people7} (${f.risingOpens7} opens), saving ${f.savers7}, month ${f.people30} (${f.monthOpens30}), hot ${f.webPeople7}/${f.sitePeople7}`
}

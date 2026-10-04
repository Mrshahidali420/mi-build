/**
 * The public change log behind /updates (and the "last change" line on
 * /about). Written by hand: one entry per change a reader would notice,
 * newest first. Data refreshes are not listed; they happen every six hours.
 *
 * Add an entry here when a change goes live. Keep each line short and in
 * plain words: what changed for the reader, not how it was built.
 */
const ENTRIES = [
  ['2026-10-04', 'Feedback and contact forms', 'You can now send feedback from any page, write to us through the contact form, and ask about sponsored spots on the new Advertise page.'],
  ['2026-10-04', 'Shop shelf', 'The Amazon box on title pages became a shelf of cards that say what each item is ("Manhwa · Vol. 1", "Light novel · Vol. 3"). Book links that led to a missing Amazon page were removed.'],
  ['2026-10-04', 'Homepage', 'The homepage no longer shows titles that have no official link yet, so every cover leads somewhere you can read or watch.'],
  ['2026-10-04', 'Trust pages', 'New pages: How we check links, Updates and Terms. The About page now says who runs the site and what is checked by hand.'],
  ['2026-10-03', 'Character pages', 'Character pages use the same layout as title pages, and the "Who is…" answer shows the full profile instead of a cut one.'],
  ['2026-10-03', 'Six-hour checks', 'Titles and links are now re-checked every six hours instead of once a day.'],
  ['2026-10-03', 'Release times', 'An anime page switches from "Not out yet" to "Out now" the moment an episode airs, without waiting for the next check.'],
  ['2026-10-03', 'Title pages', 'One clear layout for anime, manga, manhwa, manhua and novels: where to read or watch comes first, with sub or dub, episode names and a jump bar on phones.'],
  ['2026-10-03', 'Ratings and reviews', 'Readers can rate any title and write a short review. Reviews are read before they go live.'],
  ['2026-10-02', 'Cast pages', 'Cast pages name the Japanese and English voice actors, and finished shows answer "has it ended?".'],
  ['2026-09-28', 'Fix', 'Character pages linked some novels as manga, which led to a missing page. Fixed.'],
  ['2026-09-27', 'No English release', 'A title with no English platform now says so plainly and points to licensed titles like it.'],
  ['2026-09-27', 'Kodansha', 'Kodansha USA links now count as official Kodansha reading links.'],
  ['2026-09-27', 'Homepage shelves', 'New homepage shelves: Hot this week, New this season and titles readers save most.'],
  ['2026-09-25', 'Anime pages', 'Anime pages list every episode with its air date and say whether a show has an English dub.'],
  ['2026-09-24', 'Character pages', 'Each character page leads with a title that has a legal link, and character ages read as plain words.'],
  ['2026-09-23', 'My list', 'My list: save titles without an account, make your own lists, or import your AniList list.'],
  ['2026-09-23', 'Songs', 'Anime pages list every opening and ending song, with links to listen.'],
  ['2026-09-23', 'Schedule', 'A schedule of upcoming anime, and fuller genre pages.'],
  ['2026-09-23', 'Voice actors', 'English voice actors and key staff are now credited on anime pages.'],
  ['2026-09-22', 'Removed title', 'One title was removed for good for content the site will not list.'],
]

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export const UPDATES = ENTRIES.map(([date, title, text]) => ({
  date,
  dateText: DATE.format(new Date(`${date}T00:00:00Z`)),
  title,
  text,
}))

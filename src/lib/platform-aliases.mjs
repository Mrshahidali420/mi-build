/**
 * AniList site names that mean the same platform as one already in
 * scripts/anilist-core.mjs's READ_PLATFORMS list, just spelled differently.
 *
 * Checked against every site name in data/comics.json (the only variants
 * that exist today; nothing here is guessed):
 *   'Kodansha USA' -> 'Kodansha'   (Kodansha's US print imprint)
 * Yen Press and Seven Seas Entertainment have no other spelling in the data.
 *
 * Used in two places, both required:
 *   1. scripts/anilist-core.mjs / scripts/ingest.mjs, so a title ingested
 *      from today onward gets the canonical name straight away.
 *   2. src/lib/catalog.js (via migrateAliasedReadLinks below), so every
 *      record already sitting in data/comics.json also gets it, since the
 *      ingest never refetches an unchanged AniList record (it probes
 *      updatedAt) and a fix only in the ingest allowlist would never reach
 *      those.
 */
export const PLATFORM_ALIASES = {
  'Kodansha USA': 'Kodansha',
}

export const canonicalSite = (site) => PLATFORM_ALIASES[site] || site

/**
 * A record ingested before its site name was in PLATFORM_ALIASES keeps the
 * raw AniList name in otherLinks (see scripts/anilist-core.mjs's isReadLink):
 * it never matched a known read platform, so it was never a read link. This
 * moves any such link into readLinks under its canonical name, so an old
 * record reads the same as one ingested today.
 *
 * Pure: returns a new object when anything changes, and the same `item`
 * reference otherwise, so a caller can tell whether a record was touched.
 */
export function migrateAliasedLinks(item) {
  const links = item.otherLinks
  if (!links || !links.length) return item

  const kept = []
  const added = []
  for (const link of links) {
    const canonical = PLATFORM_ALIASES[link.site]
    if (!canonical) {
      kept.push(link)
      continue
    }
    const already = (item.readLinks || []).some((l) => l.site === canonical)
    if (!already && !added.some((l) => l.site === canonical)) {
      added.push({ site: canonical, url: link.url, language: link.language || null })
    }
  }
  if (!added.length) return item

  return {
    ...item,
    readLinks: [...(item.readLinks || []), ...added],
    otherLinks: kept,
  }
}

/** Runs migrateAliasedLinks over every record in place (mutates the array). */
export function migrateAliasedLinksAll(items) {
  for (let i = 0; i < items.length; i++) {
    items[i] = migrateAliasedLinks(items[i])
  }
  return items
}

# AdSense "Low-value content" fix plan (4 Oct 2026)

AdSense rejected manhwaindex.com on 4 Oct 2026. Audit: scratchpad `adsense-audit.md`
(copied facts below). Owner rules that hold: never noindex or hide a page; fatten
thin pages; no AI mention; no personal details beyond "Shahid Ali, runs it as a hobby".

## What Google sees today

- 420,304 URLs in the sitemap. 170,015 are character pages; 129,351 are sub-pages
  (`/like`, `/free`, `/buy`, `/characters`) made from the same record as their title.
- The only words the site writes itself are short template lines. Synopses are AniList's text.
- No guides, lists or articles anywhere. Nothing shows a person curating the site.
- About says the whole index "rebuilds automatically every day". That reads as "no human here".
- Thinnest pages: cast sub-pages (~110 words), minor character pages (~385 words).

## The plan

### Phase 1: show a person runs it (1-2 days)
- [ ] Rewrite /about: who runs it (only "Shahid Ali, runs it as a hobby"), what is
      checked by hand, how a link gets on the site, how to report a dead link.
- [ ] New page /how-we-check-links: the rules for "official", how often links are
      re-checked, what "no official link yet" means. Link it from every where-to list.
- [ ] New page /updates: a dated log of real changes (site features, link fixes,
      platforms added). Seed it with the last 30 days from git history. Footer link.
- [ ] Add /terms. Footer: About, How we check links, Updates, Contact, Privacy, Terms, DMCA.

### Phase 2: content only this site has (1-2 weeks)
Data guides built from our own data, with numbers no other site has. Each one is a
real page with an intro, a table and short written notes. Start with 12:
- [ ] "Manhwa you can read free on official apps" (per platform, from `/free` data).
- [ ] "Where to watch this season's anime legally" (per country, from where-links).
- [ ] "Which platform has the most licensed manga" (counts per platform).
- [ ] "Manhwa with an English official release vs fan-only" (status counts).
- [ ] Reading/watch order guides for the 8 biggest series (we already hold relations).
- [ ] One "Best of <genre> on official platforms" per top genre (romance, action, fantasy).
- [ ] New /guides hub, linked from the header menu and the homepage.
- [ ] Each guide refreshes from data on every build, so it stays current
      ("ongoing curation" in Google's words). Dated "Updated <date>".

### Phase 3: fatten the thinnest pages (1 week)
- [ ] Cast sub-pages (`/characters`): add role, voice actors (JP/EN), each face's
      first appearance and a short line per main character. Target 400+ words.
- [ ] Minor character pages: add "appears in" with every title and role, the
      voice actors, and related characters from the same title. Target 500+ words.
- [ ] Title pages: a site-written "At a glance" paragraph from our own data
      (where it is official, free or paid, sub/dub, how far the English release is),
      placed above the AniList synopsis, so the first words are ours.
- [ ] `/like` and `/free` sub-pages: one written paragraph each, from data that only
      that page has (why these match; which chapters are free where).

### Phase 4: request review (after 4-6 weeks)
- [ ] Wait until Google has recrawled the changed pages (check in Search Console).
- [ ] Re-add the AdSense script only if Ezoic is rejected. If Ezoic accepts, AdSense
      comes through Ezoic and we do not request a separate review.
- [ ] Tick "I confirm" and click "Request review" only after the owner says go.

## Not in this plan
- No noindex, no removing pages, no sitemap cuts (owner rule).
- No ad placements until Ezoic answers.
- Every phase gets a tunnel preview first and goes live only on the owner's "go".

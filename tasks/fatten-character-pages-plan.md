# Fatten thin character pages — plan (23 Oct 2026)

Owner choice: Option 2 — build more from data we already hold. One deploy
covers every character page (the page is built from the title's shard at
request time, so nothing is sliced over days).

## Why
- ~75,000 character pages have no bio; ~20,000 are the thinnest (no bio, no
  voice, one title). AniList has a bio for under 1% of them (3 of 496 sampled
  23 Oct), so AniList cannot fatten them.
- A thin page today is ~300 words, almost all shared template. Unique facts:
  name, native name, role, title, gender.
- Every title record already holds: format, status, chapters, volumes,
  episodes, start/end year, genres, tags, score, popularity, favourites,
  relations (adaptations, sequels, side stories), studios, authors, source,
  full cast with roles. Every character holds favourites.

## What each page gains (only when the fact exists — never invented)
1. **The story they are in** — one short paragraph: format and status ("an
   ongoing manhwa, 120 chapters so far" / "a finished 12-episode TV anime"),
   years, source material, the 2-3 most specific tags (e.g. "isekai, female
   lead"), AniList score and popularity in plain words.
2. **Adaptations and related stories** — from relations: the anime of this
   manga (and the reverse), sequels, prequels, side stories. Each one links to
   its own page when it is in our index (more internal links), with where to
   watch/read when we have it.
3. **Place in the cast** — cast size, how many main characters, and this
   character's rank by AniList favourites inside the cast ("the 3rd most
   favourited of 14 characters"). Unique per character.
4. **FAQ additions** — 2-3 questions answered from the facts above: "Is <title>
   finished?", "Does <title> have an anime?", "How many chapters/episodes?".
   Feeds the FAQ schema that already exists.

## How
- New pure module `src/lib/character-story.mjs`: takes (person, series, lead,
  index lookups) and returns the paragraphs + FAQ rows. No I/O.
- Sentence variety: 3-4 phrasings per sentence, picked by a stable hash of the
  slug, so 75,000 pages do not share one sentence pattern. Plain owner voice,
  no AI mention, no em dashes.
- Wire it into `src/pages/character/[slug].astro` under "About", shown for every
  character page; for pages with a bio it sits after the bio.
- Relation links reuse the existing title-slug lookup the page already uses for
  "Where <name> shows up".

## Checks (outside judge)
- Unit tests for character-story.mjs: every sentence only appears when its
  fact exists; finished/ongoing/hiatus wording; anime and manga directions;
  cast rank ties; no "undefined"/"null"/"NaN" in any output.
- Full test suite green.
- Before/after on 20 live thin pages: unique words per page (words not shared
  with the other 19), target 2x or more.
- Worker CPU per character page stays in budget (observability).
- Spot-read 5 pages by eye for clumsy sentences before calling it done.

## Not in this pass
- Fandom wiki bios (test 200 later, add only where it finds bios).
- Kanji name meanings (needs a dictionary file; later if wanted).
- AniList enrich in one big run: yield under 1%, not worth an hour of calls;
  the queue fix (9b84964) already walks all 75,000 over ~6 days.

## Tasks
- [ ] character-story.mjs + tests
- [ ] wire into the character page + FAQ
- [ ] measure 20 pages before (baseline now)
- [ ] build, tests, push, deploy
- [ ] measure 20 pages after, spot-read 5, report

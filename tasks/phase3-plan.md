# Phase 3 plan: make pages useful, not just longer (8 Oct 2026)

Why now: Google referrals fell ~93% from 7 Oct, right after the final phase of
Google's September 2026 spam update. Pages are indexed and fetchable, but top
keywords dropped out. Read as "scaled / templated content". AdSense said the
same on 4 Oct ("low value content"). Builds on tasks/adsense-fix-plan.md.

## What the code shows today

- **Title pages** (`src/pages/[kind]/[slug].astro`): site text exists.
  `src/lib/prose.mjs` writes `item.overview` at build time (~81 words), but it
  is one fixed sentence skeleton with 3-way synonym swaps (`pick()` in
  `shape()`). Across 116k pages that reads as spun text. Order: WhereTo answer,
  then Shop (Amazon), then About ("in short", then the AniList synopsis,
  ~54 words). Shared sentences on every page: "Every link on this page goes
  straight to the platform... manhwaindex hosts no chapters", "This page is
  rebuilt every day".
- **78% of titles have no official link** (~90k pages, the most alike group,
  all saying "We have found no official place...").
- **Character pages**: 44% have no AniList bio, 76% under 40 words; 64% appear
  in one title. Site text is one sentence.
- **`/characters`** (15.8k): one paragraph and face grids.
- **`/like`** (79.6k, biggest group): two paragraphs word for word the same on
  every page; one says "Nothing here is a hand-written list... rebuilt every
  day". Pick reasons are only "Shares X, Y with Z".
- **`/free`** (21.3k) and **`/buy`** (5.4k): shared "Why every link here is
  an official one" block; repeat the title page's synopsis, facts, cast and FAQ.
- Fields available in shards (`public/d/t`, `public/d/c`, built by
  `scripts/make-shards.mjs`): titles have status, chapters, volumes, episodes,
  years, season, studios, authors, staff, read/watch links with language,
  readers, ranks, tags, relations, chain, adapt, similar, recs, themes,
  characters (role, JP/EN voice), dubOf. Characters have appearsIn rows (role,
  voice, voiceEn, popularity), age, gender, birthday, favourites, namesakes.
- Tests: `node --test "tests/*.test.js"`.

## Ground rules for new text

1. Facts decide what gets said, not synonyms. Each page builds candidate facts,
   scores how unusual each one is, prints the top 3 to 5. Remove `pick()` swaps.
2. Never state a fact the record does not hold; never print a BLOCKED_TAGS tag.
3. No sentence that is the same on every page. Site-wide promises move to one
   link to /how-we-check-links.
4. Worker stays template logic over one record; whole-catalog work happens in
   `make-shards.mjs` on Actions, stored as small fact fields.
5. No AI mention, no badges or pills, homepage unchanged. No noindex anywhere.

## Steps

### Step 0: measure first
- [ ] `scripts/measure-pages.mjs`: seeded sample of 200 URLs per type (title
      with links, title without, character with bio, without bio, /characters,
      /like, /free), fetched from local dev. Report median and p10 words,
      site-written share, skeleton near-duplicate rate (names/numbers masked,
      5-word shingles, Jaccard >= 0.6), top 20 repeated sentences. Write
      `tasks/measure/<date>-<label>.json`. Baseline now, re-run after each step.
- [ ] Fast server-free check: prose functions over 2,000 shard records, same
      skeleton rate, used in tests.

### Step 1: title page "At a glance" (highest traffic)
- [ ] Rewrite `src/lib/prose.mjs` as `facts(item) -> [{key, weight, sentence}]`:
      English vs other-language availability, free/coins/subscription mix,
      status vs count, place in reading order (chain), adaptation (adapt), sub
      or dub (dubOf), director/composer (staff), songs and first OP artist
      (themes), leads and cast size, top AniList rec, rank in its kind,
      finished vs reading-now (readers). Rare facts weigh more.
- [ ] Show it as the first paragraph of WhereTo, replacing the shared closing
      sentences in `answer` (`[slug].astro` ~398-402). Synopsis stays below.
- [ ] Build time: add `sites` (first 3 site names) to `adapt.shows[]` and
      `adapt.source`, so a no-link comic can say where its anime streams.
- Tests `tests/prose-facts.test.js`: each sentence only when its field exists;
  blocked tags never appear; skeleton rate over 500 fixtures <= 0.25.
- Accept: median site words >= 140 (links) / >= 90 (no links); skeleton rate
  <= 20%; no sentence on > 5% of sampled pages. No added Worker CPU.

### Step 2: no-link title pages (~90k)
- [ ] Native-language official links, where the adaptation streams, licensed
      ReadAlike picks with one line each on why they fit.
- Accept: the most common opening sentence covers <= 10% of no-link pages.

### Step 3: character pages (170k)
- [ ] `make-shards.mjs`: `appearsIn[].year`, `costars` (top 4 sharing most
      titles), `vaOther` (up to 3 other roles of the same JP/EN voice). ~25 MB
      over 1,024 shards.
- [ ] `src/lib/character-profile.mjs`: "Profile" paragraph above the bio (role
      per medium, first year, role changes, voices, vaOther, costars, lead
      story's status and English availability). Costars/vaOther are links.
- Tests `tests/character-profile.test.js`. Accept: no-bio median >= 250 words
  (only where data exists, never pad); site share >= 60%; skeleton <= 25%.

### Step 4: `/characters`
- [ ] One line per main character (role, voices, other titles, the voice
      actor's best-known other role) and a cast summary.
- Accept: >= 400 words where >= 3 leads; skeleton <= 25%.

### Step 5: `/like` (79.6k)
- [ ] Build time: `sharedTags`, `sameAuthor`/`sameStudio`, counts, `inRecs`,
      `startYear` on each similar pick; a contrasting reason per pick; merge
      AniList recs into ranking; delete both shared paragraphs for a fact lede.
- Accept: no paragraph shared across pages; reasons differ in >= 80% of pairs.

### Step 6: `/free`
- [ ] Per-platform "how much is free" line against the title's own count.
- [ ] OWNER DECISION: repeated synopsis/facts blocks become a 2-line summary
      plus a link to the title page.

## Risks
- Spun-text patterns: remove `pick()` rather than add variants.
- Keyword stuffing: title at most once per paragraph; title tags unchanged.
- Padding: short true pages beat padded ones.
- Invented facts: every sentence gated on its field and tested.
- OWNER DECISIONS: Shop (Amazon) block sits above our text (3 Oct note: Amazon
  clicks fell when it moved lower); canonical of `/buy` to the title page (not
  before Step 0 numbers). "rebuilt every day" lines and timestamp-only
  "Checked <date>" lines go.
- Rollout: one step at a time, tunnel preview, live on owner's go, re-measure.

## Critical files
- `src/lib/prose.mjs`, `scripts/make-shards.mjs`,
  `src/pages/[kind]/[slug].astro`, `src/pages/character/[slug].astro`,
  `src/lib/answers.mjs` (likeAnswer, freeAnswer)

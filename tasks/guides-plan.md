# Guides section plan (4 Oct 2026)

Phase 2 of `tasks/adsense-fix-plan.md`. Owner chose: build all at once, with high
quality images, fast method. Keyword data: `tasks/guide-keywords-2026-10.md`.

## Architecture

- **Content:** one Markdown file per guide in `src/content/guides/<slug>.md`
  (Astro content collection). Frontmatter carries title, description, category,
  keywords, hero, `entries` (ranked/listed items) and `faq`. The body is the
  written text (intro, method, sections, verdict).
- **Entries:** each item names an AniList character id (`character: 12345`) or
  media id (`media: 12345`), plus `rank`, `heading`, `text` and optional
  `stats` (key/value pairs like "Bounty: 3,000,000,000"). The page draws a card:
  big image, name, series, voice actors when known, the written text, and links
  to the character page / title page / where to watch or read.
- **Images (fast method):** `scripts/guide-media.mjs` collects every character and
  media id used in all guides and asks AniList in bulk (`Page { characters(id_in:
  [50 ids]) }`, `Page { media(id_in: [...]) }`), saving names, `image.large`,
  cover `extraLarge`, `bannerImage`, and the character's site slug when the
  catalog has a page, to `data/guide-media.json` (committed). No per-image
  scraping, no rehosting. Hero = the series banner (1900 px) or the top entry's
  cover. Every image has width/height, lazy loading after the first, real alt text.
- **Data guides** (D-list below) are Astro pages that compute their tables from
  the catalog at build time, with written text around them, so they refresh on
  every build ("Updated <date>").
- **Hub:** `/guides` lists every guide by category with a cover image each. Linked
  from the header menu, the footer, the homepage (one row "Guides"), and from each
  title/character page that a guide covers ("Featured in: <guide>").
- **SEO:** unique title/description, one H1, Article + ItemList + FAQPage JSON-LD,
  breadcrumbs, canonical, in the sitemap, `Updated` date.
- **Writing rules:** plain, confident, accurate to canon (anime and manga), spoiler
  note where needed, no filler, no AI mention, 1,200-2,500 words for ranked guides.
  Each ranking explains its method (feats on screen, not fan theories).
  No author byline beyond "manhwaindex".

## Keyword guides (35, merged to avoid two pages fighting for one keyword)

1. Naruto strongest characters ranked
2. One Piece strongest characters ranked (also "one piece power rankings")
3. Demon Slayer Hashira ranked and explained
4. Demon Slayer strongest characters ranked (also "demon slayer characters ranked")
5. Strongest anime characters of all time (hub of all rankings)
6. One Piece bounties: highest bounties and Luffy's bounty history (merges 19 and 32)
7. Naruto filler list
8. Jujutsu Kaisen sorcerer grades explained
9. Dragon Ball power levels explained (also DBZ power levels)
10. Hunter x Hunter strongest characters ranked
11. Solo Leveling S-rank hunters ranked
12. Chainsaw Man: all devils explained
13. Goku vs Luffy: who would win?
14. Goku vs Vegeta: who wins?
15. How to read manga (beginner guide)
16. Easy anime cosplay ideas for beginners
17. Easiest anime characters to cosplay
18. Demon Slayer strongest demons ranked
19. Naruto's best fights ranked
20. Naruto vs Sasuke: every fight
21. Best manhwa to read
22. JJK special grade sorcerers ranked
23. Solo Leveling strongest characters ranked
24. Anime filler guide (hub)
25. One Piece strongest marines and pirates
26. Tallest anime characters ranked
27. Goku's power levels through every saga
28. Is Luffy the strongest in One Piece?
29. Super Saiyan forms and power levels explained
30. Anime watch order hub
31. What is power scaling? (beginner guide)
32. Chainsaw Man strongest devils ranked
33. Naruto's teachers ranked
34. Best isekai and reincarnation anime that are not overpowered
35. Male anime cosplay ideas

Added in place of the merged duplicates (topic lists showed volume; not verified one by one):
36. Solo Leveling monarchs explained
37. Anime power systems explained
38. Jujutsu Kaisen strongest characters ranked
39. Bleach strongest characters ranked
40. Attack on Titan: the nine Titans explained

## Data guides (from the first plan, built from our own data)

- D1. Manhwa you can read free on official apps
- D2. Where to watch this season's anime legally
- D3. Which platform has the most licensed manga, manhwa and manhua
- D4. Manhwa with an official English release
- D5-D12. Watch/reading order: Fate, Monogatari, Dragon Ball, Naruto, Attack on Titan, Jujutsu Kaisen, Demon Slayer, Re:Zero
- D13-D15. Best romance / action / fantasy manhwa on official platforms

## Steps

- [ ] Framework: collection, card layout, media script, hub, nav, sitemap, JSON-LD, 2 sample guides.
- [ ] Write keyword guides 1-20.
- [ ] Write keyword guides 21-40.
- [ ] Data guides D1-D15.
- [ ] Run media script, build, check, go live after the owner says go.

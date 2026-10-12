# Facebook Page posting

The workflow **Facebook Page post** (`.github/workflows/fb-post.yml`) shares one
title page at a time on the site's Facebook Page:

- a post with the cover picture and a short caption made from real facts
- then, straight away, a first comment with the link, for example
  `Where to read it: https://manhwaindex.com/manhwa/solo-leveling-105398?utm_source=facebook&utm_medium=social&utm_campaign=page`

It starts every hour (17 minutes past, a few random minutes late) and sends at
most one post per run. Most runs send nothing: a run posts only when the day is
behind its even pace (see "How it paces the day"). It never runs on a push.

Nothing goes to Facebook until you finish the steps below **and** switch it on.
Until then every run is green and only shows what it would post.

Do every step from your own phone or PC, by hand. Never let a tool or a
browser robot log in to Facebook for you.

## 1. Make the Page

In the Facebook app: Menu → Pages → Create.

- Name: **Manhwa Index**
- Category: **Entertainment website**
- Bio: *Where to read manhwa, manga and manhua legally, and what to read next.*
- Website: `https://manhwaindex.com`
- Profile picture: the site logo. Cover: any wide site banner.

Leave out your phone number, email, city and any personal detail.

## 2. Make a Meta developer app

1. Go to developers.facebook.com and log in with the same Facebook account.
2. My Apps → Create app. Pick the **Business** type (or the use case
   "Manage everything on your Page"). Name it e.g. *Manhwa Index poster*.
3. In the app, add the Pages permissions below (App Review is not needed for
   a Page you manage yourself; Standard access is enough):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_engagement`
4. App settings → Basic: set the Privacy Policy URL to
   `https://manhwaindex.com/privacy`, then switch the app from
   **Development** to **Live** at the top of the dashboard.
   Why: Meta's docs say posts made by an app in Development mode are only
   seen by people who have a role on the app. Live makes them public.

## 3. Get a Page token that does not expire

1. Open the **Graph API Explorer** (developers.facebook.com/tools/explorer).
2. Pick your app. Under "User or Page", choose **Get User Access Token** and
   tick the four permissions from step 2. Approve the pop-up.
3. Copy that token into the **Access Token Debugger**
   (developers.facebook.com/tools/debug/accesstoken) and press
   **Extend Access Token** at the bottom. You now have a long-lived user token.
4. Back in the Explorer, paste the long-lived token and run
   `me/accounts`. Find the Page in the answer. Copy its `id` (the Page ID)
   and its `access_token` (the Page token).
5. Check the Page token in the Debugger: it should say **Expires: Never** and
   list the four permissions.

Keep the token private. Do not paste it in a chat, an email or a file.

## 4. Put it in GitHub

Repo → Settings → Secrets and variables → Actions.

Secrets (tab "Secrets"):

| Name | Value |
|---|---|
| `FB_PAGE_ID` | the Page ID |
| `FB_PAGE_TOKEN` | the Page token |

Variables (tab "Variables"):

| Name | Value |
|---|---|
| `FB_POST_ENABLED` | `false` for now |
| `FB_POSTS_PER_DAY` | `4` to start. Raise it by hand as reach allows; the most it accepts is `24` (one an hour) |

## 5. Test, then switch on

1. Actions → **Facebook Page post** → Run workflow. Leave `dry_run` ticked.
2. Open the run and read the summary. It should say the token works for your
   Page and show sample posts with their first comment.
3. When you like what you see, set the variable `FB_POST_ENABLED` to `true`.
   The next hourly run that is due posts for real.

To stop at any time, set `FB_POST_ENABLED` back to `false`.

## If something goes wrong

- **"the Page token was refused"**: the token died (password change, Page role
  removed, or Meta reset it). Do step 3 again and update `FB_PAGE_TOKEN`.
- **"Post failed"**: the post did not go out and the title is marked failed.
  It is not retried, so nothing posts twice. The next run picks another title.
- **"the link comment failed"**: the post is up but the link is missing. Add
  the comment by hand on Facebook.

## How it paces the day

The day is the US Eastern day. It is cut into as many equal parts as
`FB_POSTS_PER_DAY`, and one post is due at the start of each part.

| `FB_POSTS_PER_DAY` | A post about every | Due at (US Eastern) |
|---|---|---|
| `4` | 6 hours | 00:00, 06:00, 12:00, 18:00 |
| `8` | 3 hours | 00:00, 03:00, 06:00 ... 21:00 |
| `15` | 96 minutes | 00:00, 01:36, 03:12 ... |
| `24` | 1 hour | every hour |

- Each hourly run checks how many posts went out today. Behind the line: it
  sends one. On the line: it writes "On pace" in the summary and stops.
- A run that GitHub starts late or drops is made up one post per later run,
  never as a burst.
- A manual run (Run workflow) ignores the pace and sends `count` posts, but
  never more than the day has left.

## Template posts (off until you switch them on)

Besides the classic post (a cover and a caption) there are template posts: an
image drawn for the post, 1080 x 1350, with the cover placed whole inside it,
so Facebook never crops the art. Each kind of post has its own design.

| Name | What it posts |
|---|---|
| `where` | The official reading sites of one comic or novel, and how much of it is out |
| `new-title` | A comic or novel that started in the last 75 days and already has an official site |
| `ranking` | Top 5 of a section: the ongoing titles, or one genre, by AniList readers |
| `character` | One lead character of a popular title |
| `fact` | One fact from the record, set very large |
| `next` | What to read next: three titles AniList readers recommend after one you liked |

There is no "new volume" post. The catalog holds how many volumes a title has,
never the day a volume came out, so a new volume cannot be told from an old one.

**Nothing above posts until its name is in the repo variable `FB_POST_TYPES`**
(Settings → Secrets and variables → Actions → Variables). The variable is a
comma list, and the list is exactly what runs:

| `FB_POST_TYPES` | What the Page gets |
|---|---|
| not set, or empty | classic posts only (as before) |
| `classic,where` | classic posts, plus where-to-read posts, in turns |
| `classic,where,fact,ranking` | those four kinds, in turns |
| `where,new-title,ranking,character,fact,next` | template posts only |

Leave `classic` in the list for as long as you want the plain cover posts too.
A name that is misspelt is ignored and named in the run summary; a list with
no usable name falls back to classic posts.

How the kinds share the day:

- They rotate: the kind that posted longest ago goes next.
- Nothing repeats too soon. A new title is posted once. A ranking comes back
  and a `next` post after 2 months, a character after 6 months, `where` and
  `fact` after the usual 30 days per title. Two posts about the same title never go
  out on one day.

Look before you switch a type on:

- On the PC, from the repo folder:
  `npm run social:samples -- --out "C:\some\folder"`
  writes two sample images per type and `captions.md` with every wording of
  each caption. Add `--long` to see the longest titles.
- On GitHub: Actions → **Facebook Page post** → Run workflow, keep `dry_run`
  ticked and write the names in `types` (for example `fact,where`). The run
  summary shows the captions, and the images are in the run's `fb-preview`
  artifact. The `types` box works for dry runs only; it can never post.

The images use the site's own fonts and colours and are made on the runner
(`scripts/social/render/`), with no browser. A run that draws installs the
site's packages first, which adds about a minute; a classic-only run does not.
The words on the images come from the same catalog as the pages; a fact the
record lacks is left out.

## What every post carries

A post exists to send people to the site, so each one is built the same way:

- **The image** shows quick context as labelled lines (score, genre, status,
  alt title), has a thin line round the cover so it stands off the page, and
  ends on one line that points at the first comment.
- **The caption**: a hook with an emoji, a short synopsis from the record (cut
  at a sentence end, no credits, no spoiler text), the key facts, a question
  that names the title, the line about the first comment, then up to seven
  hashtags built from the record (title, platform, season, sub-genre, kind,
  genre, one or two community tags). A part the record lacks is left out.
- **The first comment**: the site link, always first, so the preview card is
  the site.

### The Amazon line in the first comment (off)

Set the repo variable `FB_AFFILIATE_COMMENT` to `true` and the first comment
gets a second line for titles the site has a product for:

```
Where to read it: https://.../the-title?utm_source=facebook...
Get the book on Amazon: https://www.amazon.com/dp/XXXXXXXXXX?tag=manhwaindex-20
```

- The link is the same product the title page shows (`scripts/social/shop.mjs` reads the
  site's own picks and its own tag). A title with no pick gets no Amazon line;
  nothing is ever a search link.
- The tag is always `manhwaindex-20`. A test fails if any other tag could be written.
- Nothing else is added to the post or the comment about it.
- Any other value, or no variable, keeps the comment to the one site line.

## How it chooses

- About two new items for each older one. New: an anime episode airing today,
  or a series still running. Older: popular titles ("where to read it",
  plain facts, "if you liked it").
- The picture is the largest cover the source has. Older titles only have a
  small cover (230 px wide), which looks soft in the feed, so a title with a
  large cover is always taken first.
- Never the same caption style twice in a row, never the same title within
  30 days, never an adult title, never a page without an official platform.
- The record of what was posted lives on the `social-state` branch
  (`ledger.json`). A post is written there before it is sent, so two runs can
  never post the same title.
- Data comes from the catalog the deploy keeps in the GitHub Actions cache. The
  runner never loads the live site.

## Rules added in the refinement round (12 Oct 2026)

- **The mix.** The same kind of post never goes out twice running while another kind has something to post. News (the classic NEW pool) may outrank the rotation, but never a third time in a row unless nothing else is left (`plan.mjs`, `MAX_STREAK`).
- **Above the fold.** Line 1 of a caption is the hook with the title. Line 2 is the single most useful fact (the platform, the air time or the score). The synopsis, the other facts, the question and the line about the first comment follow.
- **The synopsis** never ends on a teaser question, a lead-in colon, a scrap of a few words or an ellipsis. The image carries one line about the story (the first sentence, 110 characters at most) only when that sentence is whole.
- **The title hashtag** leaves out a season or part suffix and a subtitle ("2nd Cour", "Season 3", the text after a colon).
- **Fact cards** name the title in the sentence on the image, offer one fact per title (the strongest), and skip a title with no strong fact: top 50 of an all-time chart, a long finished run, many years between the first chapter and the anime of the same name, or a score of 8.8 and up. The record holds no trustworthy yearly, seasonal or genre rank, so those are not used.
- **Blank covers.** A cover that is a logo on plain white or black is found with a 48 px probe. A grid or list leaves that tile out when it has another title to show; a post whose main picture is blank is skipped for the run. A ranking keeps its order: a title is never dropped from a ranking for its cover.
- **Small portraits** (AniList characters are 230 px wide) are enlarged at most 1.75 times, with lanczos and a light sharpen, and shown no wider than 400 px.
- **The line about the first comment** on a list post says "Start with #1" when the comment opens the title in first place, and names the list only when the comment opens a list page.
- **The Amazon line** fits the product: "Read the manga it is based on" under an anime post with a manga volume, "Get the Blu-ray on Amazon", "Get the figure on Amazon". Never "the book" for something that is not one, and never "based on" for an original anime.
- **New title** takes only a series still coming out: never a one-shot (by format), a bonus or special chapter, or a side story.

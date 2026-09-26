/**
 * The words at the top of each Amazon box.
 *
 * The box sits high on the page, so its heading has to say why this reader,
 * on this page, might want to own something. A licensed comic, a comic with no
 * English edition, an anime and a character each have a different reason, and
 * one function per page type keeps that logic out of the templates.
 *
 * Every sentence comes from the record we already hold. Nothing here invents
 * a price, a stock level, a discount or an English volume count: AniList
 * counts the original run, so a volume count is always called that.
 *
 * Pure: no catalog, no network, so the tests can call it with a plain object.
 */

/**
 * One calm line inside each box. It tells the reader the honest trade: the
 * site stays free because some readers buy through it. The formal Amazon
 * Associates sentence stays in the footer and on /privacy, never here.
 */
export const SUPPORT_LINE = 'Buying through these links helps keep manhwaindex free, at no extra cost to you.'

// A reading platform in English counts as a licence.
const hasEnglish = (item) => (item.readLinks || []).some((link) => link.language === 'English')

const volumesPart = (item, lead) => (item.volumes ? `${lead} ${item.volumes} volumes` : '')

function animeCopy(item, books) {
  const title = item.title
  const heading = `Keep ${title} on your shelf`
  // The manga row is dropped when no English print was found, so the words
  // only name it when the row is there.
  const extras = books ? 'Figures and the manga it came from' : 'Figures and merch'
  if (item.status === 'RELEASING') {
    return {
      heading,
      sub: `It is still airing, so any disc release may only cover the early episodes for now. ${extras} are here too.`,
    }
  }
  if (item.status === 'NOT_YET_RELEASED') {
    return {
      heading,
      sub: `Discs come after the broadcast. Until then, ${extras.toLowerCase()} are the way to own a piece of it.`,
    }
  }
  return {
    heading,
    sub: `A Blu-ray or DVD lets you rewatch it with no subscription, if a disc release was made. ${extras} sit alongside.`,
  }
}

function licensedCopy(item, books) {
  const title = item.title
  // A story read in English that was checked and never printed: the box
  // only holds merch, so the words must not promise volumes.
  if (!books) {
    return {
      heading: `Own a piece of ${title}`,
      sub: `We found no English print of ${title} yet, so this box points at figures and merch from the series.`,
    }
  }
  if (item.status === 'FINISHED') {
    const run = volumesPart(item, ' The original run is complete at')
    return {
      heading: `Collect ${title} in print`,
      sub: `The story is finished, so it can sit on your shelf as a whole set.${run ? `${run}.` : ''} Find the English print, plus figures and posters, on Amazon.`,
    }
  }
  if (item.status === 'RELEASING') {
    const run = volumesPart(item, ' The original run is at')
    return {
      heading: `Keep up with ${title} in print`,
      sub: `The story is still going, so start the shelf now and add each volume as it lands.${run ? `${run} so far.` : ''} Figures and posters sit alongside.`,
    }
  }
  return {
    heading: `Own ${title} in print`,
    sub: `A copy on your shelf stays yours, whatever happens to the apps. Printed volumes, figures and posters, on Amazon.`,
  }
}

function unlicensedCopy(item, books) {
  const title = item.title
  const heading = `Want ${title} on your shelf?`
  if (!books) {
    return {
      heading,
      sub: `There is no official English edition we know of yet, and we found no print on Amazon. Figures and merch from the series are the way to own a piece of it for now.`,
    }
  }
  return {
    heading,
    sub: `There is no official English edition we know of yet. Amazon's search shows any printed volumes that do exist, such as imports in the original language, plus merch from the series.`,
  }
}

/**
 * Heading and sub for the box at the top of a title page.
 *
 * `books` is false when the title was checked and has no English print
 * (booksKnown in picks.js), the same flag that drops the books row.
 * `printKnown` is true when the page shows a picked book, which proves an
 * English print exists even when no English reading platform is listed.
 */
export function titleBuyCopy(item, { books = true, printKnown = false } = {}) {
  if (item.kind === 'anime') return animeCopy(item, books)
  if (hasEnglish(item) || printKnown) return licensedCopy(item, books || printKnown)
  return unlicensedCopy(item, books)
}

/**
 * Heading and sub for the box on a character page.
 *
 * The heading names whatever the first row sells, so the box never promises
 * figures above a row of books. The book rows can name two series, so the
 * books stay "the story" and only the merch names where the face comes from.
 */
export function characterBuyCopy({ name, story, merchFirst, merchIsCharacter }) {
  if (merchFirst) {
    return {
      heading: `Own a piece of ${name}`,
      sub: `Figures, prints and apparel of ${name} from ${story}, then the books of the story. All from Amazon's live search.`,
    }
  }
  if (merchIsCharacter) {
    return {
      heading: `Books and merch of ${name}`,
      sub: `The books of the story first, then figures and merch of ${name} from ${story}. All from Amazon's live search.`,
    }
  }
  return {
    heading: `Own the story ${name} is from`,
    sub: `Printed volumes and ${story} merch, straight from Amazon's live search.`,
  }
}

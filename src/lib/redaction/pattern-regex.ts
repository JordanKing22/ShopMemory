/**
 * Regex detectors for pattern tokens (PLAN.md §4.5): EMAIL, PHONE, AMOUNT. PN shapes come from the dictionary
 * (customers' part-number patterns + the shop's RJ-/RQ- numbers). They run only on text between dictionary hits and
 * never inside a produced token. Bare numbers, hours, tolerances, percentages and spec numbers (AS9102, AMS 4911…)
 * never match AMOUNT: money needs a currency marker ("$", "USD", "dollars") or the spoken rate form "165 an hour".
 *
 * Pure. Each export is a factory, so callers never share a global regex's lastIndex.
 */

const B = "(?<![\\p{L}\\p{N}])";
const A = "(?![\\p{L}\\p{N}])";

export function emailRegex(): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}${A}`, "gu");
}

/** (+1 )?(ddd) ddd-dddd · ddd.ddd.dddd · ddd ddd dddd */
export function phoneRegex(): RegExp {
  return new RegExp(`${B}(?:\\+?1[\\s.-]?)?(?:\\(\\d{3}\\)\\s?|\\d{3}[\\s.-])\\d{3}[\\s.-]\\d{4}${A}`, "gu");
}

const NUM = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
const MAG = `(?:\\s?(?:[kKmM]|thousand|million|grand)${A})?`;
const RATE = `(?:\\s?(?:\\/|per\\s|an?\\s)\\s?(?:hour|hr|h|piece|pc|part|each|ea|unit|lb|pound)s?${A})?`;

/** $1,800 · $1800.50 · $2.5k · $165/hr · $165 per hour · USD 1,800 · 165 dollars · 165 an hour */
export function amountRegex(): RegExp {
  const dollar = `\\$\\s?${NUM}${MAG}${RATE}`;
  const usd = `${B}(?:USD|US\\$)\\s?${NUM}${MAG}${RATE}`;
  const words = `(?<![\\p{L}\\p{N}.,$])${NUM}${MAG}\\s?(?:dollars|bucks|usd)${A}${RATE}`;
  const spokenRate = `(?<![\\p{L}\\p{N}.,$])${NUM}\\s(?:an|a)\\s(?:hour|hr)${A}`;
  return new RegExp(`${dollar}|${usd}|${words}|${spokenRate}`, "giu");
}

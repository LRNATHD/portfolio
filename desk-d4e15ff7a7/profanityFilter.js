import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from 'obscenity';

/**
 * Profanity, explicit content & slur filter built on `obscenity` (`englishDataset` +
 * `englishRecommendedTransformers`), augmented with:
 * - Engineering/Scunthorpe whitelist terms (e.g. "titanium", "titration", "retardant", "cockpit", "rapeseed")
 * - Metric/unit token stripping before matching (e.g. "455kHz", "3.3V" won't trigger leetspeak `5->s` / `4->a`)
 * - Spaced-out / separator-obfuscated letter reconstruction ("f u c k", "s.h.i.t", "f-u-c-k")
 * - Secondary `1 -> l` leetspeak check (catching "s1ut", "b1owjob")
 * - Masked wildcard regexes for `* @ # $ !` censoring ("f**k", "sh*tty", "a**hole", "n*gga")
 */

const customDataset = new DataSet()
  .addAll(englishDataset)
  .addPhrase((p) => p.setMetadata({ originalWord: 'scrotum' }).addPattern(pattern`scrotum`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'kys' }).addPattern(pattern`|kys|`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'cockhead' }).addPattern(pattern`cockhead`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'shitpost' }).addPattern(pattern`shit`).addWhitelistedTerm('shiitake').addWhitelistedTerm('shitake').addWhitelistedTerm('mishit').addWhitelistedTerm('mishits'));

const PHRASE_REGEXES = [
  /\b(?:jerk|jack)[\W_]*[o0]ff\b/i,
  /\bbutt[\W_]*plugs?\b/i,
  /\bkill[\W_]*(?:your|ur)[\W_]*self\b/i,
];

const EXTRA_WHITELISTED_TERMS = [
  'retardant', 'retardants', 'retardation', 'retarder', 'retarders',
  'cockpit', 'cockpits', 'peacock', 'peacocks', 'cocktail', 'cocktails', 'cockatoo', 'hancock', 'hitchcock', 'babcock', 'shuttlecock',
  'titanium', 'titration', 'titrate', 'entity', 'entities', 'partition', 'partitions', 'constitution', 'institution', 'competition', 'superstition', 'appetite', 'repetitive',
  'rapeseed', 'grape', 'grapes', 'grapefruit', 'scrape', 'scraped', 'scraper', 'scraping', 'drape', 'trapeze', 'parapet', 'therapist', 'therapists', 'psychotherapist', 'physiotherapist',
  'scunthorpe', 'shiitake', 'shitake', 'mishit', 'mishits',
  'mobydick', 'dickens', 'benedict',
  'document', 'documents', 'documentation', 'accumulate', 'accumulator', 'circumference', 'circumstance', 'cucumber', 'succumb', 'incumbent', 'cumberland', 'encumber', 'cumbersome',
  'analysis', 'analyze', 'analyzed', 'analyzer', 'analytical', 'analytics', 'analog', 'analogue', 'canal', 'banal', 'panel', 'peninsula',
  'vibration', 'vibrations', 'vibrate', 'vibrates', 'vibrating', 'vibratory',
  'assistant', 'assist', 'assistance', 'classic', 'pass', 'bypass', 'compass', 'chassis', 'crankshaft', 'camshaft', 'piston', 'basement', 'pushbutton',
  'sextant', 'sextet', 'sextuple', 'sussex', 'essex', 'middlesex', 'unisex', 'intersex',
  'saturday', 'sturdy', 'nigeria', 'nigerian', 'niger', 'denigrate', 'snigger',
  'spice', 'spices', 'spicy', 'japan', 'japanese', 'hello', 'shell'
];

const built = customDataset.build();
built.whitelistedTerms.push(...EXTRA_WHITELISTED_TERMS);

const matcher = new RegExpMatcher({
  ...built,
  ...englishRecommendedTransformers,
});

// Wildcard censoring patterns (`obscenity` strips `*`, so detect masked swear tokens explicitly)
const MASKED_REGEXES = [
  /\bf[\W_]*(?=[u*@#$!\W_]*[*@#$!])[u*@#$!\W_]+[c*@#$!\W_]+k+(?:ing|in|ed|er|ers|s)?\b/i,
  /\bf[\W_]*[*@#$!]{1,3}[\W_]*k(?:ing|in|ed|er|ers|s)?\b/i,
  /\bs[\W_]*h[\W_]*[*!@#$]+[\W_]*t(?:ty|ting|ted|s)?\b/i,
  /\bs[\W_]*[*@#$!]{2}[\W_]*t(?:ty|ting|ted|s)?\b/i,
  /\bb[\W_]*[*@#$!]+[\W_]*t[\W_]*c[\W_]*h(?:es|ing|ed|y)?\b/i,
  /\bc[\W_]*[*@#$!]+[\W_]*n[\W_]*t(?:s)?\b/i,
  /\bd[\W_]*[*@#$!]+[\W_]*c[\W_]*k(?:head|s)?\b/i,
  /\bc[\W_]*[*@#$!]+[\W_]*c[\W_]*k(?:sucker|s)?\b/i,
  /\bp[\W_]*[*@#$!]+[\W_]*s[\W_]*s[\W_]*(?:y|ies)\b/i,
  /(?:^|[\s([{"'])a[\W_]*[*@$]{2}[\W_]*h[\W_]*[o0*]+[\W_]*l[\W_]*e(?:s)?\b/i,
  /(?:^|[\s([{"'])a[\W_]*[*@$]{2}(?=$|[\s.,!?;:)\]}"'])/i,
  /\bn[\W_]*[*!@#$]+[\W_]*g[\W_]*g[\W_]*[ae3*]+[\W_]*r?(?:s|z)?\b/i,
  /\bf[\W_]*[*@#$!]+[\W_]*g[\W_]*g?[\W_]*[o0*]*[\W_]*t?(?:s)?\b/i,
  /\bw[\W_]*h[\W_]*[*@#$!]+[\W_]*r[\W_]*e(?:s|ing)?\b/i,
  /\bs[\W_]*l[\W_]*[*@#$!]+[\W_]*t(?:s|ty)?\b/i,
];

function stripZeroWidth(str) {
  return String(str || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '');
}

function stripHardwareMetricUnits(str) {
  // Prevent numbers with units (e.g. "455kHz", "3.3V", "400MHz", "5V") and hyphenated safe names ("Moby-Dick") from false positives
  return str
    .replace(/\b\d+(?:\.\d+)?(?:hz|khz|mhz|ghz|v|mv|kv|a|ma|ua|w|mw|kw|ohm|ohms|mm|cm|m|km|kb|mb|gb|tb|px|ms|us|ns)\b/gi, ' ')
    .replace(/\bmoby[\s-]+dick\b/gi, 'mobydick');
}

function reconstructSpacedLetters(str) {
  return str.replace(
    /(^|[\s([{"'])([a-z0-9@$!*+|])(?:[\s._\-*/\\~|]+([a-z0-9@$!*+|])){2,}(?=$|[\s.,!?;:)\]}"'])/gi,
    (match, prefix) => prefix + match.slice(prefix.length).replace(/[\s._\-*/\\~|]+/g, '')
  );
}

/**
 * Checks a single string for profanity, slurs, or sexually explicit content.
 * @param {string} text
 * @returns {boolean}
 */
export function containsProfanity(text) {
  if (!text || typeof text !== 'string') return false;

  const clean = stripZeroWidth(text);
  for (const re of MASKED_REGEXES) {
    if (re.test(clean)) return true;
  }
  for (const re of PHRASE_REGEXES) {
    if (re.test(clean)) return true;
  }

  const scrubbed = stripHardwareMetricUnits(clean);
  const spacedCollapsed = reconstructSpacedLetters(scrubbed);

  const candidates = new Set([
    scrubbed,
    spacedCollapsed,
    // Secondary leetspeak pass where `1` maps to `l` (e.g. "s1ut", "b1owjob")
    scrubbed.replace(/1/g, 'l'),
    spacedCollapsed.replace(/1/g, 'l'),
  ]);

  for (const candidate of candidates) {
    if (matcher.hasMatch(candidate)) return true;
  }
  return false;
}

/**
 * Checks all fields of an idea submission.
 * @param {{ title?: string, description?: string, author?: string }} fields
 * @returns {{ clean: boolean, field?: 'title'|'description'|'author', message?: string }}
 */
export function checkSubmissionProfanity({ title = '', description = '', author = '' }) {
  if (containsProfanity(title)) {
    return {
      clean: false,
      field: 'title',
      message: 'Please remove profanity or explicit language from the Title.',
    };
  }
  if (containsProfanity(description)) {
    return {
      clean: false,
      field: 'description',
      message: 'Please remove profanity or explicit language from the Description.',
    };
  }
  if (containsProfanity(author)) {
    return {
      clean: false,
      field: 'author',
      message: 'Please remove profanity or explicit language from the Handle.',
    };
  }
  return { clean: true };
}

/**
 * Robust Profanity, Explicit Content & Slur Filter
 *
 * Defense layers:
 * 1. Unicode NFKD decomposition + combining-mark stripping + zero-width/invisible char removal.
 * 2. Cyrillic/Greek/fullwidth homoglyph transliteration (e.g. "аss", "fuсk", "ｂｉｔｃｈ").
 * 3. Spaced-out / separator-obfuscated letter reconstruction (e.g. "f u c k", "s.h.i.t", "d-i-c-k").
 * 4. Dual-pass leetspeak decoding per token (`1`->`i` and `1`->`l`, `0`->`o`, `3`->`e`, `4`/`@`->`a`, `$`/`5`->`s`, etc.).
 * 5. Character-repetition-tolerant matching (e.g. "fuuuuuck", "shiiiit", "biitch") without false positives.
 * 6. Inline wildcard mask detection (e.g. "f*ck", "f**k", "sh!t", "b*tch", "a$$hole").
 * 7. Engineering/hardware & Scunthorpe allowlist so words like "oscilloscope", "analog",
 *    "analysis", "assistant", "cockpit", "titanium", "vibration motor", "pushbutton" pass cleanly.
 */

const HOMOGLYPHS = {
  '\u0430': 'a', '\u0410': 'a', // Cyrillic a
  '\u0432': 'b', '\u0412': 'b', // Cyrillic ve
  '\u0441': 'c', '\u0421': 'c', // Cyrillic es
  '\u0435': 'e', '\u0415': 'e', // Cyrillic ie
  '\u0451': 'e', '\u0401': 'e', // Cyrillic io
  '\u043d': 'h', '\u041d': 'h', // Cyrillic en
  '\u0456': 'i', '\u0406': 'i', // Cyrillic/Ukrainian i
  '\u0457': 'i', '\u0407': 'i',
  '\u043a': 'k', '\u041a': 'k', // Cyrillic ka
  '\u043c': 'm', '\u041c': 'm', // Cyrillic em
  '\u043e': 'o', '\u041e': 'o', // Cyrillic o
  '\u0440': 'p', '\u0420': 'p', // Cyrillic er
  '\u0442': 't', '\u0422': 't', // Cyrillic te
  '\u0443': 'y', '\u0423': 'y', // Cyrillic u
  '\u0445': 'x', '\u0425': 'x', // Cyrillic ha
  '\u0455': 's', '\u0405': 's', // Cyrillic dze
  '\u0458': 'j', '\u0408': 'j', // Cyrillic je
  '\u03b1': 'a', '\u03b2': 'b', '\u03b5': 'e', '\u03b9': 'i',
  '\u03ba': 'k', '\u03bf': 'o', '\u03c1': 'p', '\u03c4': 't',
  '\u03c5': 'y', '\u03c7': 'x',
  '\u00df': 'ss', '\u00e6': 'ae', '\u0153': 'oe', '\u00f8': 'o'
};

// Unmistakable stems: matched even inside compound words (e.g. "megafuckbot", "shitpost")
// provided the whole token is not in SAFE_ALLOWLIST.
const SUBSTRING_STEMS = [
  'fuck', 'motherfuck', 'clusterfuck', 'mindfuck', 'fuckin', 'fuckwit',
  'shit', 'shithead', 'shitface', 'shitshow', 'bullshit', 'horseshit', 'dipshit', 'apeshit', 'batshit', 'dogshit', 'chickenshit',
  'bitch', 'cunt', 'nigger', 'nigga', 'faggot',
  'asshole', 'arsehole', 'dumbass', 'jackass', 'smartass', 'fatass', 'asshat', 'asswipe', 'asslick',
  'dickhead', 'dickwad', 'cockhead', 'cockface', 'cockring',
  'whore', 'slut', 'skank', 'twat', 'wanker', 'douche',
  'dildo', 'vibrator', 'buttplug', 'fleshlight', 'sextoy',
  'penis', 'vagina', 'clitoris', 'scrotum', 'testicle', 'ballsack',
  'blowjob', 'handjob', 'rimjob', 'titjob', 'cocksuck', 'jerkoff', 'jackoff',
  'masturbat', 'ejaculat', 'orgasm', 'jizz',
  'porn', 'hentai', 'onlyfans',
  'pedophil', 'bestiality', 'tranny', 'wetback', 'beaner',
  'titties', 'titty', 'boobies'
];

// Whole-word (or inflected) targets: matched only at token boundaries so benign substrings
// like "classic", "document", "analysis", "cockpit", "scrape", "Saturday", "hello" never trigger.
const EXACT_WORDS = [
  'ass', 'asses', 'arse', 'arses',
  'cock', 'cocks', 'dick', 'dicks',
  'pussy', 'pussies', 'clit', 'clits',
  'cum', 'cums', 'cumming', 'cumshot', 'cumshots',
  'tit', 'tits', 'boob', 'boobs',
  'anal', 'anus', 'rectum', 'semen', 'sperm',
  'sex', 'sexy', 'nude', 'nudes', 'naked', 'horny', 'boner', 'boners', 'erection', 'erections',
  'nsfw', 'bdsm', 'milf', 'thot', 'thots',
  'piss', 'pissed', 'pissing', 'pisses',
  'turd', 'turds', 'spunk', 'prick', 'pricks', 'bastard', 'bastards', 'scumbag', 'scumbags',
  'bollocks', 'bugger', 'wank', 'wanks', 'wanking',
  'fag', 'fags', 'retard', 'retards', 'retarded', 'dyke', 'dykes', 'kike', 'kikes', 'spic', 'spics',
  'chink', 'chinks', 'gook', 'gooks', 'coon', 'coons',
  'negro', 'negros', 'negroes',
  'rape', 'raped', 'rapes', 'raping', 'rapist', 'rapists', 'molest', 'molested', 'molesting', 'pedo', 'pedos',
  'fap', 'faps', 'fapping',
  'wtf', 'stfu', 'gtfo', 'lmfao', 'kys',
  'nazi', 'nazis', 'hitler'
];

// Multi-word phrases checked across adjacent words
const PHRASES = [
  'jerk off', 'jack off', 'blow job', 'hand job', 'rim job', 'tit job',
  'sex toy', 'butt plug', 'son of a bitch', 'piece of shit',
  'kill yourself', 'kill urself', 'kys',
  'suck my', 'eat my ass', 'lick my', 'deep throat', 'golden shower'
];

// Masked/censored profanity regexes (matched only when a censoring symbol [*@#$!] is present)
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
  /\bs[\W_]*l[\W_]*[*@#$!]+[\W_]*t(?:s|ty)?\b/i
];

// Safe allowlist for words containing otherwise-flagged substrings (Scunthorpe protection)
const SAFE_ALLOWLIST = new Set([
  'scunthorpe', 'shiitake', 'shitake', 'mishit', 'mishits',
  'cockpit', 'cockpits', 'peacock', 'peacocks', 'cocktail', 'cocktails',
  'cockatoo', 'cockatoos', 'hancock', 'hitchcock', 'babcock', 'woodcock', 'shuttlecock',
  'dickens', 'mobydick', 'benedict',
  'titanium', 'titration', 'titrate', 'entity', 'entities', 'partition', 'partitions',
  'constitution', 'constitutional', 'institution', 'competition', 'superstition',
  'appetite', 'repetitive', 'stitched', 'stitch', 'switch', 'pitch', 'hitch', 'ditch', 'kitchen',
  'therapist', 'therapists', 'psychotherapist', 'physiotherapist', 'rapeseed', 'grape', 'grapes',
  'grapefruit', 'scrape', 'scraped', 'scraper', 'scrapers', 'scraping', 'drape', 'drapes',
  'trapeze', 'parapet', 'serape',
  'document', 'documents', 'documentation', 'documented', 'accumulate', 'accumulated', 'accumulator',
  'circumference', 'circumstances', 'circumstance', 'circumvent', 'cucumber', 'succumb', 'incumbent',
  'cumberland', 'encumber', 'cumbersome',
  'peninsula', 'peninsular',
  'analysis', 'analyze', 'analyzed', 'analyzer', 'analyzers', 'analytical', 'analytics',
  'analog', 'analogue', 'canal', 'canals', 'banal', 'panel', 'panels', 'catalog', 'catalogue',
  'signal', 'signals', 'signaling', 'night', 'nights', 'knight', 'midnight', 'benign', 'malign',
  'assign', 'design', 'resign', 'ignition', 'insignia', 'significant', 'signature',
  'assistant', 'assist', 'assists', 'assistance', 'classic', 'classics', 'classical',
  'pass', 'passed', 'passes', 'passing', 'bypass', 'compass', 'passage', 'passenger',
  'glass', 'glasses', 'grass', 'brass', 'mass', 'masses', 'massive', 'bass', 'chassis',
  'harass', 'cassette', 'embassy', 'lasso', 'tassel', 'vassal', 'canvass', 'carcass',
  'assume', 'assumed', 'assumes', 'assumption', 'asset', 'assets', 'assess', 'assessed', 'assessment',
  'assert', 'assault', 'assemble', 'assembly', 'associate', 'associated', 'assure', 'assured',
  'assortment', 'potassium', 'crankshaft', 'camshaft', 'shaft',
  'piston', 'pistons', 'bastion', 'basement', 'basements',
  'retardant', 'retardants', 'retardation', 'retarder', 'retarders',
  'vibration', 'vibrations', 'vibrate', 'vibrates', 'vibrating', 'vibratory',
  'pushbutton', 'button', 'buttons', 'butter', 'butterfly', 'butternut', 'buttress', 'abut',
  'hello', 'shell', 'shells', 'hellenistic', 'hellenic', 'michelle',
  'sextant', 'sextet', 'sextuple', 'sussex', 'essex', 'middlesex', 'wessex', 'unisex', 'intersex',
  'sarcophagus', 'esophagus', 'asparagus',
  'spice', 'spices', 'spicy', 'suspicion', 'suspicious', 'auspices', 'auspicious',
  'niger', 'nigeria', 'nigerian', 'denigrate', 'snigger',
  'raccoon', 'cocoon', 'tycoon', 'lagoon', 'baboon', 'balloon', 'saloon', 'platoon', 'cartoon',
  'japan', 'japanese', 'jalapeno',
  'count', 'counts', 'counter', 'discount', 'account', 'mountain', 'fountain', 'bounty', 'county',
  'push', 'brush', 'crush', 'flush', 'slush', 'plush', 'thrush', 'blush',
  'sluggish', 'slurry', 'slump', 'salute', 'solution', 'dilute', 'pollute', 'resolute', 'absolute'
]);

/**
 * Builds a character-repetition-tolerant RegExp for a canonical lowercase word
 * (preserving intentional double-letters like "ss" in "ass" or "gg" in "nigger").
 */
function buildRepeatRegex(word, exact) {
  let pattern = '';
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    let run = 1;
    while (i + run < word.length && word[i + run] === ch) {
      run++;
    }
    const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern += run > 1 ? `${escaped}{${run},}` : `${escaped}+`;
    i += run;
  }
  return exact ? new RegExp(`^${pattern}$`) : new RegExp(pattern);
}

const EXACT_REGEXES = EXACT_WORDS.map(w => buildRepeatRegex(w, true));
const SUBSTRING_REGEXES = SUBSTRING_STEMS.map(w => ({
  word: w,
  regex: buildRepeatRegex(w, false)
}));

function normalizeUnicodeAndHomoglyphs(input) {
  let s = String(input || '')
    // Remove zero-width / soft-hyphen / directional formatting chars
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    // Decompose accents/diacritics
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '');

  let mapped = '';
  for (const ch of s) {
    mapped += HOMOGLYPHS[ch] || ch;
  }
  return mapped.toLowerCase();
}

function decodeLeetspeak(token, oneAsChar) {
  // Only decode digits/symbols if the token isn't purely numeric/version/dimension (like "400", "3.3v", "100mhz")
  if (/^\d+(?:[.,]\d+)?[a-z]{0,3}$/i.test(token) && !/[013456789@$!+|].*[a-z]{2,}/i.test(token)) {
    return token.replace(/[^a-z]/g, '');
  }
  const map = {
    '0': 'o',
    '1': oneAsChar,
    '!': 'i',
    '|': oneAsChar,
    '3': 'e',
    '4': 'a',
    '@': 'a',
    '$': 's',
    '5': 's',
    '7': 't',
    '+': 't',
    '8': 'b',
    '9': 'g',
    '6': 'g'
  };
  let out = '';
  for (const ch of token) {
    if (map[ch]) {
      out += map[ch];
    } else if (ch >= 'a' && ch <= 'z') {
      out += ch;
    }
  }
  return out;
}

/**
 * Collapses obfuscated single-character runs like "f u c k", "s.h.i.t", "b-i-t-c-h".
 */
function reconstructSpacedLetters(text) {
  // Rejoin sequences of >= 3 single-character tokens separated by whitespace or inline punctuation
  return text.replace(
    /(^|[\s([{"'])([a-z0-9@$!*+|])(?:[\s._\-*/\\~|]+([a-z0-9@$!*+|])){2,}(?=$|[\s.,!?;:)\]}"'])/gi,
    (match, prefix) => {
      const compact = match.slice(prefix.length).replace(/[\s._\-*/\\~|]+/g, '');
      return prefix + compact;
    }
  );
}

function tokenMatchesProfanity(alphaToken) {
  if (!alphaToken || alphaToken.length < 3) return false;
  if (SAFE_ALLOWLIST.has(alphaToken)) return false;

  for (const re of EXACT_REGEXES) {
    if (re.test(alphaToken)) return true;
  }

  for (const { regex } of SUBSTRING_REGEXES) {
    if (regex.test(alphaToken)) return true;
  }

  return false;
}

/**
 * Evaluates a single string for profanity, slurs, or sexually explicit content.
 * @param {string} text
 * @returns {boolean} true if profanity or explicit content is detected
 */
export function containsProfanity(text) {
  if (!text || typeof text !== 'string') return false;

  const norm = normalizeUnicodeAndHomoglyphs(text);

  // 1. Check inline masked forms (e.g. "f*ck", "sh*t", "b**ch")
  for (const re of MASKED_REGEXES) {
    if (re.test(norm)) return true;
  }

  // 2. Reconstruct obfuscated separated letters ("f u c k", "s.h.i.t") alongside original text
  const expandedTexts = [norm, reconstructSpacedLetters(norm)];

  for (const candidateText of expandedTexts) {
    // Tokenize preserving inline leet symbols (@, $, !, +, *, |)
    const rawTokens = candidateText.split(/[\s,;:!?()[\]{}"'<>\\/~`^&=]+/).filter(Boolean);
    const decodedTokensForPhrases = [];

    for (const raw of rawTokens) {
      // Also strip internal dots/hyphens/underscores inside single tokens ("f.u.c.k", "sh_it")
      const tight = raw.replace(/[._\-*]+/g, '');
      const variants = new Set([
        raw.replace(/[^a-z]/g, ''),
        tight.replace(/[^a-z]/g, ''),
        decodeLeetspeak(raw, 'i'),
        decodeLeetspeak(raw, 'l'),
        decodeLeetspeak(tight, 'i'),
        decodeLeetspeak(tight, 'l')
      ]);

      let primaryDecoded = '';
      for (const v of variants) {
        if (!v) continue;
        if (!primaryDecoded) primaryDecoded = v;
        if (tokenMatchesProfanity(v)) return true;
      }
      if (primaryDecoded) decodedTokensForPhrases.push(primaryDecoded);
    }

    // 3. Phrase checks over adjacent decoded words
    const joinedWords = decodedTokensForPhrases.join(' ');
    for (const phrase of PHRASES) {
      const phraseRe = new RegExp(`(?:^|\\s)${phrase}(?:\\s|$)`);
      if (phraseRe.test(joinedWords)) return true;
    }
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
      message: 'Please remove profanity or explicit language from the Title.'
    };
  }
  if (containsProfanity(description)) {
    return {
      clean: false,
      field: 'description',
      message: 'Please remove profanity or explicit language from the Description.'
    };
  }
  if (containsProfanity(author)) {
    return {
      clean: false,
      field: 'author',
      message: 'Please remove profanity or explicit language from the Handle.'
    };
  }
  return { clean: true };
}

'use strict';

/**
 * Release-name matching.
 *
 * When Stremio plays a file it tells the subtitle addon the file's name
 * (`extra.filename`). Subtitle releases carry their own names, and picking the
 * one that belongs to the same release is what makes a subtitle line up with
 * the video — the timing of a subtitle is tied to the specific edit and frame
 * rate it was made for.
 *
 * The naive approach — count shared words — does not work, because every
 * candidate shares the film title (`Inception`, `2010`). Those shared words
 * push every candidate over any fixed threshold, so a CAM rip looks just as
 * good as the matching BluRay.
 *
 * Instead the words are weighted by how *rare* they are among the candidates.
 * A token that every candidate carries (`inception`) tells us nothing, while
 * one that a single candidate carries (`amiable`) identifies a release. This
 * needs no hard-coded list of release-group names or codecs.
 */

/** Extensions and container words that never identify a release. */
const NOISE = new Set([
	'srt', 'vtt', 'ass', 'ssa', 'sub', 'subs', 'subtitle', 'subtitles', 'txt', 'zip', 'rar',
	'mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts',
	'www', 'com', 'net', 'org', 'html', 'http', 'https',
]);

/** Language tags, which identify a translation rather than a release. */
const LANGUAGE_TAGS = new Set([
	'eng', 'en', 'chi', 'chs', 'cht', 'zht', 'zho', 'zh', 'cn', 'tw', 'hk', 'zh-cn', 'zh-tw',
	'jpn', 'ja', 'kor', 'ko', 'spa', 'es', 'fra', 'fre', 'fr', 'deu', 'ger', 'de', 'ita', 'it',
	'por', 'pt', 'rus', 'ru', 'ara', 'ar', 'pol', 'pl', 'nld', 'dut', 'nl', 'tur', 'tr',
	'vie', 'vi', 'tha', 'th', 'ind', 'id', 'heb', 'he', 'hun', 'hu', 'ces', 'cs', 'cze',
	'ell', 'el', 'gre', 'ron', 'ro', 'rum', 'ukr', 'uk', 'bul', 'bg', 'hrv', 'hr', 'srp', 'sr',
	'slk', 'sk', 'slv', 'sl', 'lit', 'lt', 'lav', 'lv', 'est', 'et', 'cat', 'ca', 'msa', 'ms',
	'may', 'fil', 'tl', 'tgl', 'ben', 'bn', 'tam', 'ta', 'tel', 'te', 'urd', 'ur', 'fas', 'fa',
	'per', 'swa', 'sw', 'afr', 'af', 'isl', 'is', 'ice', 'mkd', 'mk', 'sqi', 'sq', 'alb',
	'kat', 'ka', 'geo', 'aze', 'az', 'kaz', 'kk', 'uzb', 'uz', 'yue', 'multi', 'dual',
]);

/**
 * Splits a release name into the tokens that could identify it.
 *
 * Kept deliberately dumb: dots, underscores, brackets and dashes all become
 * separators, because release names use them interchangeably
 * (`x264-AMIABLE` and `x264.AMIABLE` are the same release).
 */
function releaseTokens(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/[._\-+[\]]+/g, ' ')
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 3 && !NOISE.has(token) && !LANGUAGE_TAGS.has(token));
}

/**
 * Scores every candidate against the file being played.
 *
 * `distinct` is the answer to "is this candidate *identifiably* the right
 * release?" — it is true only when a token that few other candidates carry is
 * also present in the video's filename. That is a much stronger claim than
 * "shares the most words", and it is what the picker marks.
 *
 * @param {Array<object>} items candidates, each with a `name`
 * @param {string} videoName the file Stremio is playing, if it told us
 * @returns {Array<{ item: object, index: number, score: number, distinct: boolean }>}
 */
function rankByMatch(items, videoName) {
	const videoTokens = new Set(releaseTokens(videoName));
	const total = items.length;
	const tokensOf = items.map((item) => new Set(releaseTokens(item.name)));

	// How many candidates carry each token.
	const frequency = new Map();
	for (const set of tokensOf) {
		for (const token of set) frequency.set(token, (frequency.get(token) || 0) + 1);
	}

	// A token carried by at most this many candidates can tell releases apart.
	// With one candidate there is nothing to compare against, so any shared
	// token counts.
	const rareLimit = Math.max(1, Math.ceil(total / 3));

	const scored = items.map((item, index) => {
		let score = 0;
		let distinct = false;
		for (const token of tokensOf[index]) {
			if (!videoTokens.has(token)) continue;
			const seen = frequency.get(token) || 1;
			score += Math.log(1 + total / seen);
			if (seen <= rareLimit) distinct = true;
		}
		return { item, index, score, distinct };
	});

	scored.sort((a, b) => b.score - a.score || a.index - b.index);
	return scored;
}

module.exports = { releaseTokens, rankByMatch, NOISE, LANGUAGE_TAGS };

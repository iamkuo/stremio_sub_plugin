'use strict';

/**
 * Language-code plumbing.
 *
 * Stremio subtitle sources hand out ISO 639-2/B three-letter codes (`eng`,
 * `zht`), while Google Translate and the OpenSubtitles.com REST API expect
 * two-letter codes (`en`, `zh-tw`). Everything is normalised to lower case on
 * the way in and mapped on the way out.
 */

/** Lower-cases and unifies separators so `zh_TW` and `ZH-tw` compare equal. */
function normalizeLang(lang) {
	return String(lang || '').toLowerCase().replace(/_/g, '-').trim();
}

/**
 * Stremio language code -> Google source language. Google uses lower-case
 * codes. Cantonese is deliberately absent: Google does not support it, so the
 * caller omits `sl` and lets the service detect the language itself.
 */
const GOOGLE_SOURCES = {
	eng: 'en', en: 'en',
	jpn: 'ja', ja: 'ja',
	kor: 'ko', ko: 'ko',
	fra: 'fr', fre: 'fr', fr: 'fr',
	deu: 'de', ger: 'de', de: 'de',
	spa: 'es', es: 'es',
	ita: 'it', it: 'it',
	por: 'pt', pt: 'pt',
	rus: 'ru', ru: 'ru',
	ara: 'ar', ar: 'ar',
	hin: 'hi', hi: 'hi',
	tha: 'th', th: 'th',
	vie: 'vi', vi: 'vi',
	ind: 'id', id: 'id',
	tur: 'tr', tr: 'tr',
	pol: 'pl', pl: 'pl',
	nld: 'nl', dut: 'nl', nl: 'nl',
	swe: 'sv', sv: 'sv',
	dan: 'da', da: 'da',
	fin: 'fi', fi: 'fi',
	nor: 'nb', nb: 'nb',
	ces: 'cs', cze: 'cs', cs: 'cs',
	ell: 'el', gre: 'el', el: 'el',
	heb: 'he', he: 'he',
	hun: 'hu', hu: 'hu',
	ron: 'ro', rum: 'ro', ro: 'ro',
	ukr: 'uk', uk: 'uk',
	bul: 'bg', bg: 'bg',
	hrv: 'hr', hr: 'hr',
	srp: 'sr', sr: 'sr',
	slk: 'sk', sk: 'sk',
	slv: 'sl', sl: 'sl',
	lit: 'lt', lt: 'lt',
	lav: 'lv', lv: 'lv',
	est: 'et', et: 'et',
	cat: 'ca', ca: 'ca',
	msa: 'ms', may: 'ms', ms: 'ms',
	fil: 'tl', tgl: 'tl', tl: 'tl',
	ben: 'bn', bn: 'bn',
	tam: 'ta', ta: 'ta',
	tel: 'te', te: 'te',
	urd: 'ur', ur: 'ur',
	fas: 'fa', per: 'fa', fa: 'fa',
	swa: 'sw', sw: 'sw',
	afr: 'af', af: 'af',
	isl: 'is', ice: 'is', is: 'is',
	mkd: 'mk', mk: 'mk',
	sqi: 'sq', alb: 'sq', sq: 'sq',
	kat: 'ka', geo: 'ka', ka: 'ka',
	aze: 'az', az: 'az',
	kaz: 'kk', kk: 'kk',
	uzb: 'uz', uz: 'uz',
	zho: 'zh', chi: 'zh', zh: 'zh', zht: 'zh', chs: 'zh', cht: 'zh',
};

/** OpenCC target locale -> Google `tl` code. Google has no `zh-HK`. */
const GOOGLE_TARGETS = {
	cn: 'zh-CN',
	t: 'zh-TW',
	tw: 'zh-TW',
	twp: 'zh-TW',
	hk: 'zh-TW',
	hkp: 'zh-TW',
	jp: 'ja',
};

/** Stremio language code -> OpenSubtitles.com REST `languages` code. */
const REST_CODES = {
	eng: 'en', en: 'en',
	jpn: 'ja', ja: 'ja',
	kor: 'ko', ko: 'ko',
	fra: 'fr', fre: 'fr', fr: 'fr',
	deu: 'de', ger: 'de', de: 'de',
	spa: 'es', es: 'es',
	ita: 'it', it: 'it',
	por: 'pt-BR', pt: 'pt-BR',
	rus: 'ru', ru: 'ru',
	ara: 'ar', ar: 'ar',
	hin: 'hi', hi: 'hi',
	tha: 'th', th: 'th',
	vie: 'vi', vi: 'vi',
	ind: 'id', id: 'id',
	tur: 'tr', tr: 'tr',
	pol: 'pl', pl: 'pl',
	nld: 'nl', dut: 'nl', nl: 'nl',
	swe: 'sv', sv: 'sv',
	dan: 'da', da: 'da',
	fin: 'fi', fi: 'fi',
	nor: 'nb', nb: 'nb',
	ces: 'cs', cze: 'cs', cs: 'cs',
	ell: 'el', gre: 'el', el: 'el',
	heb: 'he', he: 'he',
	hun: 'hu', hu: 'hu',
	ron: 'ro', rum: 'ro', ro: 'ro',
	ukr: 'uk', uk: 'uk',
	zho: 'zh-cn', chi: 'zh-cn', chs: 'zh-cn', 'zh-cn': 'zh-cn', 'zh-hans': 'zh-cn',
	zht: 'zh-tw', cht: 'zh-tw', 'zh-tw': 'zh-tw', 'zh-hant': 'zh-tw', 'zh-hk': 'zh-tw',
};

/** Resolves a code through the map, then through its primary subtag. */
function lookup(map, lang) {
	const normalized = normalizeLang(lang);
	if (!normalized) return null;
	if (Object.prototype.hasOwnProperty.call(map, normalized)) return map[normalized];
	return map[normalized.split('-')[0]] || null;
}

/**
 * Google source language for a Stremio code, or null to let Google detect the
 * language itself (which is what happens for unsupported codes like `yue`).
 */
function toGoogleSource(lang) {
	return lookup(GOOGLE_SOURCES, lang);
}

/** Google target language for an OpenCC locale. */
function toGoogleTarget(locale) {
	return GOOGLE_TARGETS[locale] || 'zh-TW';
}

/** OpenSubtitles.com REST language code for a Stremio code. */
function toRestCode(lang) {
	return lookup(REST_CODES, lang);
}

module.exports = {
	normalizeLang,
	toGoogleSource,
	toGoogleTarget,
	toRestCode,
	GOOGLE_SOURCES,
	GOOGLE_TARGETS,
	REST_CODES,
};

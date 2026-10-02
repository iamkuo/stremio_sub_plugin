'use strict';

/**
 * Language-code plumbing.
 *
 * Stremio subtitle sources hand out ISO 639-2/B three-letter codes (`eng`,
 * `zht`), while DeepL and the OpenSubtitles.com REST API expect two-letter
 * codes (`EN`, `en`, `zh-tw`). Everything is normalised to lower case on the
 * way in and mapped on the way out.
 */

/** Lower-cases and unifies separators so `zh_TW` and `ZH-tw` compare equal. */
function normalizeLang(lang) {
	return String(lang || '').toLowerCase().replace(/_/g, '-').trim();
}

/** Stremio language code -> DeepL source language. */
const DEEPL_SOURCES = {
	eng: 'EN', en: 'EN',
	jpn: 'JA', ja: 'JA',
	kor: 'KO', ko: 'KO',
	fra: 'FR', fre: 'FR', fr: 'FR',
	deu: 'DE', ger: 'DE', de: 'DE',
	spa: 'ES', es: 'ES',
	ita: 'IT', it: 'IT',
	por: 'PT', pt: 'PT',
	rus: 'RU', ru: 'RU',
	ara: 'AR', ar: 'AR',
	hin: 'HI', hi: 'HI',
	tha: 'TH', th: 'TH',
	vie: 'VI', vi: 'VI',
	ind: 'ID', id: 'ID',
	tur: 'TR', tr: 'TR',
	pol: 'PL', pl: 'PL',
	nld: 'NL', dut: 'NL', nl: 'NL',
	swe: 'SV', sv: 'SV',
	dan: 'DA', da: 'DA',
	fin: 'FI', fi: 'FI',
	nor: 'NB', nb: 'NB',
	ces: 'CS', cze: 'CS', cs: 'CS',
	ell: 'EL', gre: 'EL', el: 'EL',
	heb: 'HE', he: 'HE',
	hun: 'HU', hu: 'HU',
	ron: 'RO', rum: 'RO', ro: 'RO',
	ukr: 'UK', uk: 'UK',
	bul: 'BG', bg: 'BG',
	hrv: 'HR', hr: 'HR',
	srp: 'SR', sr: 'SR',
	slk: 'SK', sk: 'SK',
	slv: 'SL', sl: 'SL',
	lit: 'LT', lt: 'LT',
	lav: 'LV', lv: 'LV',
	est: 'ET', et: 'ET',
	cat: 'CA', ca: 'CA',
	msa: 'MS', may: 'MS', ms: 'MS',
	fil: 'TL', tgl: 'TL', tl: 'TL',
	ben: 'BN', bn: 'BN',
	tam: 'TA', ta: 'TA',
	tel: 'TE', te: 'TE',
	urd: 'UR', ur: 'UR',
	fas: 'FA', per: 'FA', fa: 'FA',
	swa: 'SW', sw: 'SW',
	afr: 'AF', af: 'AF',
	isl: 'IS', ice: 'IS', is: 'IS',
	mkd: 'MK', mk: 'MK',
	sqi: 'SQ', alb: 'SQ', sq: 'SQ',
	kat: 'KA', geo: 'KA', ka: 'KA',
	aze: 'AZ', az: 'AZ',
	kaz: 'KK', kk: 'KK',
	uzb: 'UZ', uz: 'UZ',
	yue: 'YUE',
	// DeepL cannot read `ZH-HANT`/`ZH-HANS` as a source, only `ZH`.
	zho: 'ZH', chi: 'ZH', zh: 'ZH', zht: 'ZH', chs: 'ZH', cht: 'ZH',
};

/** OpenCC target locale -> DeepL target language. */
const DEEPL_TARGETS = {
	cn: 'ZH-HANS',
	t: 'ZH-HANT',
	tw: 'ZH-HANT',
	twp: 'ZH-HANT',
	hk: 'ZH-HANT',
	hkp: 'ZH-HANT',
	jp: 'JA',
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

/** DeepL source language for a Stremio code, or null to let DeepL auto-detect. */
function toDeepLSource(lang) {
	return lookup(DEEPL_SOURCES, lang);
}

/** DeepL target language for an OpenCC locale. */
function toDeepLTarget(locale) {
	return DEEPL_TARGETS[locale] || 'ZH-HANT';
}

/** OpenSubtitles.com REST language code for a Stremio code. */
function toRestCode(lang) {
	return lookup(REST_CODES, lang);
}

module.exports = {
	normalizeLang,
	toDeepLSource,
	toDeepLTarget,
	toRestCode,
	DEEPL_SOURCES,
	REST_CODES,
};

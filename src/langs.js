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

/**
 * Canonical code -> the ISO 639-2/B spelling, for services that want the
 * three-letter form. Derived from the source map by preferring its three-letter
 * key, so the codes are declared in exactly one place.
 */
const BIBLIOGRAPHIC_CODES = (() => {
	const map = {};
	for (const [key, value] of Object.entries(GOOGLE_SOURCES)) {
		const current = map[value];
		if (!current || (key.length === 3 && current.length !== 3)) map[value] = key;
	}
	return map;
})();

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

/** Every spelling of Chinese that may arrive, including the ones SubSense rejects. */
const CHINESE_CODES = new Set([
	'zho', 'chi', 'zh', 'zht', 'chs', 'cht', 'cn', 'tw', 'hk',
	'zh-cn', 'zh-tw', 'zh-hk', 'zh-hans', 'zh-hant',
]);

/**
 * SubSense language code.
 *
 * SubSense wants ISO 639-2/B codes, which is what Stremio already speaks for
 * most languages — but not for Chinese, where Stremio sends `zht` and SubSense
 * does not recognise it. Worse, it fails *quietly*: an unknown code yields
 * English subtitles rather than an error, so `zht` would look like a working
 * source that simply has no Chinese.
 */
function toSubsenseCode(lang) {
	const normalized = normalizeLang(lang);
	if (!normalized) return null;
	if (CHINESE_CODES.has(normalized)) return 'chi';
	// Callers hand over canonical codes as often as Stremio ones, and SubSense
	// wants the three-letter form either way.
	return BIBLIOGRAPHIC_CODES[canonicalLang(normalized)] || normalized.split('-')[0];
}

/**
 * Groups every spelling of one language under a single code.
 *
 * A single film routinely carries `zht`, `cht` and `zh-tw` entries at once, and
 * all three are the same language to a viewer. Without collapsing them first,
 * a "3 per language" cap would let one language occupy three slots under three
 * different names.
 */
function canonicalLang(lang) {
	const normalized = normalizeLang(lang);
	if (!normalized) return '';
	if (CHINESE_CODES.has(normalized)) return 'zh';
	// Stremio speaks ISO 639-2/B (`eng`), most other places speak 639-1 (`en`),
	// and a group keyed on one would never match a group keyed on the other.
	// Google's map already knows both spellings, so it is reused here.
	const google = lookup(GOOGLE_SOURCES, normalized);
	return (google || normalized).split('-')[0];
}

/** A comma list of codes, canonicalised and de-duplicated, order preserved. */
function canonicalList(value) {
	const codes = String(value || '')
		.split(/[,\s]+/)
		.map(canonicalLang)
		.filter(Boolean);
	const unique = [];
	for (const code of codes) if (!unique.includes(code)) unique.push(code);
	return unique;
}

/**
 * Short display names, used to label subtitles that are served untouched in
 * their original language. Kept in the language's own script where that is the
 * readable form, and short enough for Stremio's narrow picker column.
 */
const LANGUAGE_NAMES = {
	zh: '中文',
	en: 'English',
	ja: '日本語',
	ko: '한국어',
	fr: 'Français',
	de: 'Deutsch',
	es: 'Español',
	it: 'Italiano',
	pt: 'Português',
	ru: 'Русский',
	ar: 'العربية',
	hi: 'हिन्दी',
	th: 'ไทย',
	vi: 'Tiếng Việt',
	id: 'Indonesia',
	tr: 'Türkçe',
	pl: 'Polski',
	nl: 'Nederlands',
	sv: 'Svenska',
	da: 'Dansk',
	fi: 'Suomi',
	nb: 'Norsk',
	cs: 'Čeština',
	el: 'Ελληνικά',
	he: 'עברית',
	hu: 'Magyar',
	ro: 'Română',
	uk: 'Українська',
	bg: 'Български',
	hr: 'Hrvatski',
	sr: 'Српски',
	sk: 'Slovenčina',
	sl: 'Slovenščina',
	lt: 'Lietuvių',
	lv: 'Latviešu',
	et: 'Eesti',
	ca: 'Català',
	ms: 'Melayu',
	tl: 'Filipino',
	bn: 'বাংলা',
	ta: 'தமிழ்',
	te: 'తెలుగు',
	ur: 'اردو',
	fa: 'فارسی',
	sw: 'Kiswahili',
	af: 'Afrikaans',
	is: 'Íslenska',
	mk: 'Македонски',
	sq: 'Shqip',
	ka: 'ქართული',
	az: 'Azərbaycan',
	kk: 'Қазақша',
	uz: 'Oʻzbek',
	yue: '粵語',
};

/** Display name for a language code, falling back to the code itself. */
function languageName(lang) {
	const canonical = canonicalLang(lang);
	if (!canonical) return '';
	return LANGUAGE_NAMES[canonical] || canonical.toUpperCase();
}

/** The languages offered in the config page's picker, in display order. */
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES).map(([code, name]) => ({ code, name }));

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

/**
 * Canonical codes Google can produce as a *target*.
 *
 * Taken from the source map, so it inherits its deliberate gaps — Cantonese is
 * absent there because Google cannot translate it.
 */
const GOOGLE_TARGET_LANGS = new Set(Object.values(GOOGLE_SOURCES));

/**
 * Google target code for a canonical language, or null when Google cannot
 * produce that language at all — the caller then declines to offer an entry
 * rather than handing the viewer a link that can only fail.
 *
 * Chinese is the special case: the exact variant is the viewer's OpenCC choice,
 * so the configured locale decides between `zh-CN` and `zh-TW`. Every other
 * language is already keyed by its Google code.
 */
function toGoogleLanguage(code, openccLocale) {
	const canonical = canonicalLang(code);
	if (!canonical) return null;
	if (canonical === 'zh') return toGoogleTarget(openccLocale);
	return GOOGLE_TARGET_LANGS.has(canonical) ? canonical : null;
}

/** OpenSubtitles.com REST language code for a Stremio code. */
function toRestCode(lang) {
	return lookup(REST_CODES, lang);
}

module.exports = {
	normalizeLang,
	canonicalLang,
	canonicalList,
	languageName,
	toSubsenseCode,
	toGoogleSource,
	toGoogleTarget,
	toGoogleLanguage,
	GOOGLE_TARGET_LANGS,
	toRestCode,
	GOOGLE_SOURCES,
	GOOGLE_TARGETS,
	REST_CODES,
	LANGUAGE_NAMES,
	LANGUAGE_OPTIONS,
};

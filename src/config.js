'use strict';

const { resolvePair, DEFAULT_FROM, DEFAULT_TO } = require('./opencc');

/**
 * Addon settings. The whole object is stored in the addon URL as
 * base64url(JSON) using the short keys below, so the install deep link stays
 * compact and URL-safe (no `{`, `"` or `:` characters to escape).
 */
const DEFAULTS = {
	from: DEFAULT_FROM,
	to: DEFAULT_TO,
	mode: 'auto', // 'auto' = only convert Simplified subtitles, 'always' = always convert
	keepOriginal: false, // also expose the untouched source subtitle
	langs: 'zht,chi,zho,chs,cht,zh-cn,zh-tw', // accepted Chinese subtitle language codes
	provider: 'v3', // 'v3' = OpenSubtitles v3 proxy (no key), 'rest' = OpenSubtitles.com API
	sourceUrl: 'https://opensubtitles-v3.strem.io',
	apiKey: '', // OpenSubtitles.com API key
	customDict: '',
	// DeepL fallback: used only when no Chinese subtitle exists for the video.
	deeplKey: '', // the viewer's own DeepL API key
	fallbackLangs: 'eng', // languages to machine translate when no Chinese subtitle exists
	fallbackProvider: 'auto', // 'auto' = Google then DeepL, or force 'google' / 'deepl'
	fallbackLimit: 1, // how many fallback candidates to offer; 1 keeps the picker minimal
};

const KEYMAP = {
	from: 'f',
	to: 't',
	mode: 'm',
	keepOriginal: 'k',
	langs: 'l',
	provider: 'p',
	sourceUrl: 'u',
	apiKey: 'a',
	customDict: 'd',
	deeplKey: 'dk',
	fallbackLangs: 'fl',
	fallbackProvider: 'fp',
	fallbackLimit: 'fn',
};

const PROVIDERS = ['v3', 'rest'];
const FALLBACK_PROVIDERS = ['auto', 'google', 'deepl'];
/** Upper bound for the configurable fallback list length. */
const MAX_FALLBACK_LIMIT = 5;

function clampFallbackLimit(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return DEFAULTS.fallbackLimit;
	return Math.min(MAX_FALLBACK_LIMIT, Math.max(1, Math.round(number)));
}

function sameValue(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Settings object -> compact base64url string for the addon URL. */
function encodeConfig(settings) {
	const merged = { ...DEFAULTS, ...(settings || {}) };
	const short = {};
	for (const [long, shortKey] of Object.entries(KEYMAP)) {
		if (!sameValue(merged[long], DEFAULTS[long])) short[shortKey] = merged[long];
	}
	return Buffer.from(JSON.stringify(short), 'utf8').toString('base64url');
}

/** Coerces arbitrary input into a valid settings object. */
function normalizeConfig(raw) {
	const cfg = { ...DEFAULTS, ...(raw || {}) };
	const [from, to] = resolvePair(cfg.from, cfg.to);
	cfg.from = from;
	cfg.to = to;
	cfg.mode = cfg.mode === 'always' ? 'always' : 'auto';
	cfg.keepOriginal = cfg.keepOriginal === true || cfg.keepOriginal === 'true';
	cfg.provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'v3';
	cfg.langs = String(cfg.langs || '').trim();
	cfg.sourceUrl = String(cfg.sourceUrl || '').trim() || DEFAULTS.sourceUrl;
	cfg.apiKey = String(cfg.apiKey || '').trim();
	cfg.customDict = String(cfg.customDict || '');
	cfg.deeplKey = String(cfg.deeplKey || '').trim();
	cfg.fallbackLangs = String(cfg.fallbackLangs || '').trim();
	cfg.fallbackProvider = FALLBACK_PROVIDERS.includes(cfg.fallbackProvider) ? cfg.fallbackProvider : 'auto';
	cfg.fallbackLimit = clampFallbackLimit(cfg.fallbackLimit);
	return cfg;
}

/** base64url string from the addon URL -> settings object. */
function decodeConfig(encoded) {
	if (!encoded || encoded === 'default') return normalizeConfig({});
	let raw;
	try {
		raw = JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8'));
	} catch {
		return normalizeConfig({});
	}
	if (!raw || typeof raw !== 'object') return normalizeConfig({});

	const settings = {};
	for (const [long, shortKey] of Object.entries(KEYMAP)) {
		if (raw[shortKey] !== undefined) settings[long] = raw[shortKey];
	}
	return normalizeConfig(settings);
}

/** Settings object -> the URL path segment used by every addon route. */
function configPath(settings) {
	return encodeConfig(normalizeConfig(settings));
}

module.exports = {
	DEFAULTS,
	KEYMAP,
	PROVIDERS,
	FALLBACK_PROVIDERS,
	MAX_FALLBACK_LIMIT,
	clampFallbackLimit,
	encodeConfig,
	decodeConfig,
	normalizeConfig,
	configPath,
};

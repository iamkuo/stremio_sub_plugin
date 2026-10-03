'use strict';

const { resolvePair, DEFAULT_FROM, DEFAULT_TO } = require('./opencc');
const { canonicalList } = require('./langs');

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
	// Languages to list, in priority order. Chinese codes are converted with
	// OpenCC; every other language is listed untouched, in its original form.
	langs: 'zh',
	perLanguageLimit: 3, // how many subtitles to offer per language
	provider: 'v3', // 'v3' = upstream Stremio addons, 'rest' = OpenSubtitles.com API
	sources: 'https://opensubtitles-v3.strem.io', // upstream addons, comma or newline separated
	apiKey: '', // OpenSubtitles.com API key
	customDict: '',
	// Machine translation, used only when no Chinese subtitle exists at all.
	fallbackLangs: 'eng', // source languages to translate from, e.g. 'eng,jpn'
	fallbackLimit: 1, // how many fallback candidates to offer; 1 keeps the picker minimal
	// Frame-rate correction, applied when a subtitle was timed for a different
	// frame rate than the file being played. 'auto' only corrects the direction
	// that cannot be a false positive (see src/fps.js).
	fpsMode: 'auto',
};

const KEYMAP = {
	from: 'f',
	to: 't',
	mode: 'm',
	keepOriginal: 'k',
	langs: 'l',
	perLanguageLimit: 'pl',
	provider: 'p',
	sources: 's',
	apiKey: 'a',
	customDict: 'd',
	fallbackLangs: 'fl',
	fallbackLimit: 'fn',
	fpsMode: 'fm',
};

const PROVIDERS = ['v3', 'rest'];
/** Upper bound for the configurable fallback list length. */
const MAX_FALLBACK_LIMIT = 5;
/** Upper bound for the per-language subtitle count. */
const MAX_PER_LANGUAGE_LIMIT = 10;
const FPS_MODES = ['auto', 'off', '25to23976', '23976to25'];

function clampFallbackLimit(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return DEFAULTS.fallbackLimit;
	return Math.min(MAX_FALLBACK_LIMIT, Math.max(1, Math.round(number)));
}

function clampPerLanguageLimit(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return DEFAULTS.perLanguageLimit;
	return Math.min(MAX_PER_LANGUAGE_LIMIT, Math.max(1, Math.round(number)));
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
	// Stored canonically so the config page's picker and the server agree on
	// what "the same language" means, whatever spelling a source used.
	cfg.langs = canonicalList(cfg.langs).join(',') || DEFAULTS.langs;
	cfg.sources = String(cfg.sources || '').trim() || DEFAULTS.sources;
	cfg.apiKey = String(cfg.apiKey || '').trim();
	cfg.customDict = String(cfg.customDict || '');
	cfg.fallbackLangs = String(cfg.fallbackLangs || '').trim();
	cfg.fallbackLimit = clampFallbackLimit(cfg.fallbackLimit);
	cfg.perLanguageLimit = clampPerLanguageLimit(cfg.perLanguageLimit);
	cfg.fpsMode = FPS_MODES.includes(cfg.fpsMode) ? cfg.fpsMode : DEFAULTS.fpsMode;
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
	// `u` held a single upstream server before this became a list. Install
	// links created back then keep working instead of silently falling back to
	// the default source.
	if (raw.u !== undefined && raw.s === undefined) settings.sources = raw.u;
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
	MAX_FALLBACK_LIMIT,
	MAX_PER_LANGUAGE_LIMIT,
	FPS_MODES,
	clampFallbackLimit,
	clampPerLanguageLimit,
	encodeConfig,
	decodeConfig,
	normalizeConfig,
	configPath,
};

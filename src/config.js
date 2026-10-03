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
	// Languages to list, in priority order. Chinese codes are converted with
	// Languages are split into two tiers. A *primary* language is a promise: if
	// the film has nothing in it, a machine translation is offered instead. A
	// *secondary* language is a preference: if it is missing, it is simply
	// absent. Chinese is converted with OpenCC; anything else is listed as it
	// is, in its original language.
	langs: 'zh', // primary languages, in display order
	secondary: '', // secondary languages, shown as-is and never translated
	perLanguageLimit: 3, // how many subtitles to offer per language, in either tier
	provider: 'v3', // 'v3' = upstream Stremio addons, 'rest' = OpenSubtitles.com API
	sources: 'https://opensubtitles-v3.strem.io', // upstream addons, comma or newline separated
	apiKey: '', // OpenSubtitles.com API key
	customDict: '',
	// What a primary language is machine translated *from* when the film has
	// nothing in that language, e.g. 'eng,jpn' prefers English.
	fallbackLangs: 'eng',
	// Frame-rate correction, applied when a subtitle was timed for a different
	// frame rate than the file being played. 'auto' only corrects the direction
	// that cannot be a false positive (see src/fps.js).
	fpsMode: 'auto',
};

const KEYMAP = {
	from: 'f',
	to: 't',
	mode: 'm',
	langs: 'l',
	secondary: 'sc',
	perLanguageLimit: 'pl',
	provider: 'p',
	sources: 's',
	apiKey: 'a',
	customDict: 'd',
	fallbackLangs: 'fl',
	fpsMode: 'fm',
};

const PROVIDERS = ['v3', 'rest'];
/** Upper bound for the per-language subtitle count. */
const MAX_PER_LANGUAGE_LIMIT = 10;
const FPS_MODES = ['auto', 'off', '25to23976', '23976to25'];

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
	cfg.provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'v3';
	// Stored canonically so the config page's picker and the server agree on
	// what "the same language" means, whatever spelling a source used.
	cfg.langs = canonicalList(cfg.langs).join(',') || DEFAULTS.langs;
	cfg.secondary = canonicalList(cfg.secondary).join(',');
	cfg.sources = String(cfg.sources || '').trim() || DEFAULTS.sources;
	cfg.apiKey = String(cfg.apiKey || '').trim();
	cfg.customDict = String(cfg.customDict || '');
	cfg.fallbackLangs = String(cfg.fallbackLangs || '').trim();
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
	MAX_PER_LANGUAGE_LIMIT,
	FPS_MODES,
	clampPerLanguageLimit,
	encodeConfig,
	decodeConfig,
	normalizeConfig,
	configPath,
};

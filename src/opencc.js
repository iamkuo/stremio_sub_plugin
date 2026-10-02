'use strict';

const OpenCC = require('opencc-js');
const SIMPLIFIED_CHARS = require('./data/simplified-chars');

/** Locale codes understood by opencc-js, with display labels. */
const LOCALES = {
	cn: '簡體中文（中國大陸）',
	t: '繁體中文（OpenCC 標準）',
	tw: '繁體中文（台灣）',
	twp: '繁體中文（台灣・含詞彙轉換）',
	hk: '繁體中文（香港）',
	hkp: '繁體中文（香港・含詞彙轉換）',
	jp: '日文新字體',
};

/** Conversion pairs supported by opencc-js: from -> [to]. */
const PAIRS = {
	cn: ['t', 'tw', 'twp', 'hk', 'hkp'],
	t: ['cn', 'tw', 'hk', 'jp'],
	tw: ['cn', 't'],
	twp: ['cn'],
	hk: ['cn', 't'],
	hkp: ['cn'],
	jp: ['t'],
};

const DEFAULT_FROM = 'cn';
const DEFAULT_TO = 'twp';

const SIMPLIFIED_SET = new Set(Array.from(SIMPLIFIED_CHARS));

/** Returns a supported [from, to] pair, falling back to the default one. */
function resolvePair(from, to) {
	if (PAIRS[from] && PAIRS[from].includes(to)) return [from, to];
	return [DEFAULT_FROM, DEFAULT_TO];
}

function targetsFor(from) {
	return PAIRS[from] || PAIRS[cn];
}

/** Language code Stremio should display for the converted output. */
function outputLang(to) {
	if (to === 'cn') return 'zho';
	if (to === 'jp') return 'jpn';
	return 'zht';
}

/**
 * Parses a user supplied dictionary: one `original=converted` pair per line.
 * `=`, tab, `,`, `，` and `|` are accepted as separators; `#` starts a comment.
 */
function parseCustomDict(text) {
	const pairs = [];
	for (const rawLine of String(text || '').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const match = /^(.+?)\s*[=\t,，|]\s*(.+)$/.exec(line);
		if (!match) continue;
		const from = match[1].trim();
		const to = match[2].trim();
		if (from && to && from !== to) pairs.push([from, to]);
	}
	return pairs;
}

const converterCache = new Map();
const CONVERTER_CACHE_LIMIT = 64;

/** Builds (and caches) the OpenCC converter described by a config object. */
function converterFor(cfg) {
	const [from, to] = resolvePair(cfg.from, cfg.to);
	const custom = parseCustomDict(cfg.customDict);
	const key = `${from}|${to}|${JSON.stringify(custom)}`;

	const cached = converterCache.get(key);
	if (cached) return cached;

	const base = OpenCC.Converter({ from, to });
	let converter = base;
	if (custom.length) {
		// Custom pairs are applied on top of the standard conversion, so users can
		// override anything OpenCC produced (OpenCC "extra dictionary" semantics).
		const customConverter = OpenCC.CustomConverter(custom);
		converter = (text) => customConverter(base(text));
	}

	if (converterCache.size >= CONVERTER_CACHE_LIMIT) converterCache.clear();
	converterCache.set(key, converter);
	return converter;
}

/** True when the text contains characters that only exist in Simplified Chinese. */
function looksSimplified(text) {
	for (const char of text) {
		if (SIMPLIFIED_SET.has(char)) return true;
	}
	return false;
}

const INDEX_LINE = /^\s*\d+\s*$/;
const TIMING_LINE = /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/;

/**
 * Converts subtitle text (SRT or WebVTT) line by line, leaving cue numbers and
 * timing lines untouched.
 *
 * @returns {{ text: string, convertedLines: number, totalLines: number, skipped: boolean }}
 */
function convertSubtitle(text, cfg) {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);

	if (cfg.mode === 'auto' && !looksSimplified(text)) {
		return { text, convertedLines: 0, totalLines: 0, skipped: true };
	}

	const converter = converterFor(cfg);
	let convertedLines = 0;
	let totalLines = 0;

	const output = lines.map((line) => {
		if (!line || INDEX_LINE.test(line) || TIMING_LINE.test(line)) return line;
		totalLines += 1;
		const converted = converter(line);
		if (converted !== line) convertedLines += 1;
		return converted;
	});

	return { text: output.join(eol), convertedLines, totalLines, skipped: false };
}

module.exports = {
	LOCALES,
	PAIRS,
	DEFAULT_FROM,
	DEFAULT_TO,
	resolvePair,
	targetsFor,
	outputLang,
	parseCustomDict,
	converterFor,
	looksSimplified,
	convertSubtitle,
};

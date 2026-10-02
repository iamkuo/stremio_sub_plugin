'use strict';

/**
 * Google Translate fallback — the first fallback, because it needs no key.
 *
 * This calls the same endpoint the Chrome translation extension uses
 * (`client=dict-chrome-ex`). It is undocumented and unauthenticated, so it is
 * treated as best effort: two hosts are tried, each failure is retried once,
 * and the caller's chain moves on to DeepL when this gives up.
 *
 * Only `translate_a/t` is used. The better known
 * `translate_a/single?client=gtx` variant answers HTTP 429 from datacenter IPs,
 * while `translate_a/t` does not, and it also accepts several `q` parameters in
 * one request with a flat, order-preserving response.
 */

const { translateSubtitleText, mapWithConcurrency } = require('./srt');

const HOSTS = ['https://translate.googleapis.com', 'https://clients5.google.com'];
const PATH = '/translate_a/t';
const CLIENT = 'dict-chrome-ex';
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Mirrors the DeepL limits so both providers behave the same way. */
const MAX_TEXTS_PER_REQUEST = 50;
/** Query strings are kept well under the ~8 KB that was verified to work. */
const MAX_QUERY_LENGTH = 6000;
const REQUEST_TIMEOUT = 20000;
/** A feature length subtitle is ~30 requests; four at a time keeps it quick
 *  without looking like abuse to an unauthenticated endpoint. */
const MAX_CONCURRENT_REQUESTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `GOOGLE_API_URL` points the test suite at its mock server. */
function hosts() {
	if (process.env.GOOGLE_API_URL) return [String(process.env.GOOGLE_API_URL).replace(/\/+$/, '')];
	return HOSTS;
}

function buildQuery(texts, { sourceLang, targetLang }) {
	const parts = [`client=${CLIENT}`, `tl=${encodeURIComponent(targetLang)}`];
	if (sourceLang) parts.push(`sl=${encodeURIComponent(sourceLang)}`);
	for (const text of texts) parts.push(`q=${encodeURIComponent(text)}`);
	return parts.join('&');
}

/**
 * Splits texts into requests that stay within both the text count and the URL
 * length the endpoint accepts.
 * @returns {string[][]}
 */
function batchTexts(texts) {
	const batches = [];
	let current = [];
	let length = 0;

	for (const text of texts) {
		const size = encodeURIComponent(text).length + 3;
		if (current.length && (current.length >= MAX_TEXTS_PER_REQUEST || length + size > MAX_QUERY_LENGTH)) {
			batches.push(current);
			current = [];
			length = 0;
		}
		current.push(text);
		length += size;
	}
	if (current.length) batches.push(current);
	return batches;
}

/**
 * The endpoint answers with a flat array of strings, but `sl=auto` switches to
 * `[text, detectedLanguage]` pairs, so both shapes are accepted.
 */
function parseTranslations(payload) {
	if (!Array.isArray(payload)) throw new Error('回傳了非預期的格式');
	return payload.map((entry) => {
		if (typeof entry === 'string') return entry;
		if (Array.isArray(entry)) return String(entry[0] ?? '');
		if (entry && typeof entry.t === 'string') return entry.t;
		return '';
	});
}

/** One request, with host failover and a single retry per host. */
async function requestBatch(texts, options) {
	const errors = [];

	for (const host of hosts()) {
		const url = `${host}${PATH}?${buildQuery(texts, options)}`;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const response = await fetch(url, {
					headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
					signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);

				const body = await response.text();
				let payload;
				try {
					payload = JSON.parse(body);
				} catch {
					// Rate limiting answers with an HTML page rather than JSON.
					throw new Error(`非 JSON 回應（HTTP ${response.status}）`);
				}

				const translations = parseTranslations(payload);
				if (translations.length !== texts.length) {
					throw new Error(`回傳 ${translations.length} 段，預期 ${texts.length} 段`);
				}
				return translations;
			} catch (error) {
				errors.push(`${new URL(host).host}：${error.message}`);
				if (attempt === 0) await sleep(600);
			}
		}
	}

	throw new Error(`Google 翻譯失敗（${errors.join('；')}）`);
}

/**
 * Translates a list of independent strings, preserving order.
 *
 * @returns {Promise<{texts: string[], requests: number}>}
 */
async function translateTexts(texts, { sourceLang, targetLang }) {
	const batches = batchTexts(texts);
	const results = await mapWithConcurrency(batches, MAX_CONCURRENT_REQUESTS, (batch) =>
		requestBatch(batch, { sourceLang, targetLang })
	);
	return { texts: results.flat(), requests: batches.length };
}

/** Translates a whole SRT/VTT file, leaving cue numbers and timings alone. */
async function translateSubtitle(text, { sourceLang, targetLang }) {
	return translateSubtitleText(text, (sources) => translateTexts(sources, { sourceLang, targetLang }));
}

module.exports = {
	translateSubtitle,
	translateTexts,
	batchTexts,
	parseTranslations,
	buildQuery,
	hosts,
	MAX_TEXTS_PER_REQUEST,
	MAX_CONCURRENT_REQUESTS,
};

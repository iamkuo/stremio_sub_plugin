'use strict';

/**
 * DeepL client used for the fallback path.
 *
 * When no Chinese subtitle exists for a video, the addon can take one of the
 * languages the user listed as a fallback (English by default) and machine
 * translate it instead of converting it. Translation is deliberately performed
 * on download rather than while listing, so DeepL quota is only spent on the
 * subtitle the viewer actually picks.
 *
 * The key never leaves the addon URL: it is decoded per request and used
 * directly against DeepL. Nothing is stored server side.
 */

const { splitSegments, translateSubtitleText, mapWithConcurrency } = require('./srt');

const FREE_HOST = 'https://api-free.deepl.com';
const PRO_HOST = 'https://api.deepl.com';

/** DeepL accepts at most 50 `text` parameters and a 128 KiB body per request. */
const MAX_TEXTS_PER_REQUEST = 50;
const MAX_BYTES_PER_REQUEST = 60 * 1024;
const REQUEST_TIMEOUT = 60000;
/** DeepL explicitly allows parallel requests; four keeps latency down. */
const MAX_CONCURRENT_REQUESTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free DeepL keys carry a `:fx` suffix and only work on the free host; every
 * other key is treated as a Pro key. `DEEPL_API_URL` overrides both, which is
 * what the test suite points at its mock server.
 */
function apiHost(apiKey) {
	if (process.env.DEEPL_API_URL) return String(process.env.DEEPL_API_URL).replace(/\/+$/, '');
	return String(apiKey || '').trim().endsWith(':fx') ? FREE_HOST : PRO_HOST;
}

/** Turns a DeepL failure into something worth showing a user. */
function describeStatus(status, detail) {
	if (status === 400) return `DeepL 請求無效：${detail || '未知原因'}`;
	if (status === 403) return 'DeepL 拒絕這個 API Key（請確認金鑰正確，免費金鑰需以 :fx 結尾）';
	if (status === 413) return '字幕內容超過 DeepL 單次請求上限';
	if (status === 429) return 'DeepL 請求過於頻繁，請稍後再試';
	if (status === 456) return 'DeepL 額度已用完（免費方案每月 50 萬字元，可於 DeepL 帳戶查詢）';
	return `DeepL 回應 HTTP ${status}${detail ? `：${detail}` : ''}`;
}

async function readDetail(response) {
	try {
		const text = await response.text();
		try {
			return String(JSON.parse(text).message || text).slice(0, 200);
		} catch {
			return text.slice(0, 200);
		}
	} catch {
		return '';
	}
}

async function callTranslate(apiKey, params) {
	const response = await fetch(`${apiHost(apiKey)}/v2/translate`, {
		method: 'POST',
		headers: {
			Authorization: `DeepL-Auth-Key ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(params),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});

	if (!response.ok) {
		const error = new Error(describeStatus(response.status, await readDetail(response)));
		error.statusCode = response.status === 456 || response.status === 403 ? 402 : 502;
		error.retryable = response.status === 429;
		throw error;
	}

	const payload = await response.json();
	return (payload.translations || []).map((entry) => entry.text);
}

/**
 * Splits texts into requests that respect both DeepL limits.
 * @returns {string[][]}
 */
function batchTexts(texts) {
	const batches = [];
	let current = [];
	let bytes = 0;

	for (const text of texts) {
		const size = Buffer.byteLength(text, 'utf8');
		if (current.length && (current.length >= MAX_TEXTS_PER_REQUEST || bytes + size > MAX_BYTES_PER_REQUEST)) {
			batches.push(current);
			current = [];
			bytes = 0;
		}
		current.push(text);
		bytes += size;
	}
	if (current.length) batches.push(current);
	return batches;
}

/**
 * Translates a list of independent strings, preserving order.
 *
 * @param {string} apiKey
 * @param {string[]} texts
 * @param {{sourceLang?: string, targetLang: string}} options
 * @returns {Promise<string[]>}
 */
async function translateTexts(apiKey, texts, { sourceLang, targetLang }) {
	const batches = batchTexts(texts);

	const results = await mapWithConcurrency(batches, MAX_CONCURRENT_REQUESTS, async (batch) => {
		const params = { text: batch, target_lang: targetLang };
		if (sourceLang) params.source_lang = sourceLang;

		let translated;
		try {
			translated = await callTranslate(apiKey, params);
		} catch (error) {
			if (!error.retryable) throw error;
			await sleep(1500);
			translated = await callTranslate(apiKey, params);
		}

		if (translated.length !== batch.length) {
			throw new Error('DeepL 回傳的翻譯數量與請求不符');
		}
		return translated;
	});

	return results.flat();
}

/**
 * Translates a whole SRT/VTT file, leaving cue numbers and timing lines alone.
 *
 * @returns {{ text: string, characters: number, requests: number, segments: number }}
 */
async function translateSubtitle(text, { apiKey, sourceLang, targetLang }) {
	return translateSubtitleText(text, async (sources) => ({
		texts: await translateTexts(apiKey, sources, { sourceLang, targetLang }),
		requests: batchTexts(sources).length,
	}));
}

/** Reads the account's character usage, used by the config page's key check. */
async function fetchUsage(apiKey) {
	const response = await fetch(`${apiHost(apiKey)}/v2/usage`, {
		headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok) throw new Error(describeStatus(response.status, await readDetail(response)));

	const payload = await response.json();
	const characterCount = Number(payload.character_count) || 0;
	const characterLimit = Number(payload.character_limit) || 0;
	return {
		characterCount,
		characterLimit,
		percent: characterLimit ? Math.round((characterCount / characterLimit) * 100) : null,
		host: apiHost(apiKey),
	};
}

module.exports = {
	translateSubtitle,
	translateTexts,
	fetchUsage,
	batchTexts,
	splitSegments,
	apiHost,
	describeStatus,
	MAX_TEXTS_PER_REQUEST,
	MAX_CONCURRENT_REQUESTS,
};

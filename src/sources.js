'use strict';

/**
 * Subtitle sources.
 *
 * `v3`   – proxies the public OpenSubtitles v3 Stremio addon. No API key, no
 *          sign-up. The upstream already returns UTF-8 SRT files, which keeps
 *          this addon dependency free.
 * `rest` – talks to the official OpenSubtitles.com REST API. Much better
 *          Chinese coverage, but requires a (free) API key.
 */

const DEFAULT_SOURCE_URL = 'https://opensubtitles-v3.strem.io';
const REST_BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'OpenCC-Stremio-Subtitles v1.0';

const REQUEST_TIMEOUT = 10000;

/** Language codes that can possibly be Chinese, used when no filter is set. */
const CHINESE_LANGS = new Set([
	'zht', 'chi', 'zho', 'chs', 'cht', 'zh', 'cn', 'tw', 'hk',
	'zh-cn', 'zh-tw', 'zh-hk', 'zh-hans', 'zh-hant',
]);

function normalizeLang(lang) {
	return String(lang || '').toLowerCase().replace(/_/g, '-').trim();
}

function langFilter(cfg) {
	return String(cfg.langs || '')
		.split(/[,\s]+/)
		.map(normalizeLang)
		.filter(Boolean);
}

function langAllowed(cfg, lang) {
	const wanted = langFilter(cfg);
	const normalized = normalizeLang(lang);
	if (!normalized) return false;
	if (!wanted.length) return CHINESE_LANGS.has(normalized);
	return wanted.includes(normalized);
}

/** IMDb ids look like `tt1234567` (movies) or `tt1234567:1:2` (series). */
function sanitizeId(id) {
	return String(id || '').replace(/[^A-Za-z0-9:._-]/g, '');
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(options.headers || {}) },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT),
	});
	if (!response.ok) {
		throw new Error(`${url} responded with HTTP ${response.status}`);
	}
	return response.json();
}

async function listFromProxy(cfg, type, id) {
	const base = String(cfg.sourceUrl || DEFAULT_SOURCE_URL).replace(/\/+$/, '');
	const payload = await fetchJson(`${base}/subtitles/${type}/${sanitizeId(id)}.json`);
	const subtitles = (payload && payload.subtitles) || [];

	return subtitles
		.filter((sub) => sub && sub.url && langAllowed(cfg, sub.lang))
		.map((sub) => ({
			id: String(sub.id || sub.url),
			url: sub.url,
			lang: normalizeLang(sub.lang),
			name: sub.subtitleFileName || sub.movieReleaseName || '',
		}));
}

async function listFromRest(cfg, type, id) {
	if (!cfg.apiKey) {
		throw new Error('OpenSubtitles.com 需要 API Key，請在設定頁填入（或在設定頁改用免金鑰的 v3 來源）。');
	}

	const [imdbId, season, episode] = String(id).split(':');
	const numericId = String(imdbId).replace(/^tt/, '');

	const params = new URLSearchParams({ languages: 'zh-cn,zh-tw' });
	if (type === 'series') {
		params.set('parent_imdb_id', numericId);
		if (season) params.set('season_number', String(Number(season)));
		if (episode) params.set('episode_number', String(Number(episode)));
	} else {
		params.set('imdb_id', numericId);
	}

	const payload = await fetchJson(`${REST_BASE}/subtitles?${params.toString()}`, {
		headers: { 'Api-Key': cfg.apiKey },
	});

	const results = [];
	for (const item of payload.data || []) {
		const attributes = item.attributes || {};
		const lang = normalizeLang(attributes.language);
		if (!langAllowed(cfg, lang)) continue;
		const file = (attributes.files || [])[0];
		if (!file || !file.file_id) continue;
		results.push({
			id: String(file.file_id),
			fileId: file.file_id,
			lang,
			name: file.file_name || attributes.release || '',
		});
	}
	return results;
}

/** Resolves a `fileId` into a temporary download link. */
async function resolveDownloadLink(cfg, fileId) {
	const payload = await fetchJson(`${REST_BASE}/download`, {
		method: 'POST',
		headers: { 'Api-Key': cfg.apiKey, 'Content-Type': 'application/json' },
		body: JSON.stringify({ file_id: Number(fileId) }),
	});
	if (!payload.link) throw new Error('OpenSubtitles.com 未回傳下載連結');
	return payload.link;
}

/** Lists candidate subtitles for one video. */
async function listSubtitles(cfg, type, id) {
	if (!['movie', 'series'].includes(type)) return [];
	if (cfg.provider === 'rest') return listFromRest(cfg, type, id);
	return listFromProxy(cfg, type, id);
}

module.exports = {
	DEFAULT_SOURCE_URL,
	listSubtitles,
	resolveDownloadLink,
	normalizeLang,
	langAllowed,
};

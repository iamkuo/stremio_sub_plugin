'use strict';

/**
 * Subtitle sources.
 *
 * Two ways to reach subtitles:
 *
 * `v3`   – reads any number of upstream Stremio addons over the standard
 *          subtitle protocol (`GET {base}/subtitles/{type}/{id}.json`). No API
 *          key, and each upstream may carry its own configuration in its base
 *          URL, so a personalised addon install link works as-is.
 * `rest` – talks to the official OpenSubtitles.com REST API. Much better
 *          Chinese coverage, but requires a (free) API key.
 *
 * Listing returns every candidate the sources offer; deciding which of them are
 * usable is the caller's job (see subtitles.js), because the addon keeps two
 * separate allow lists: Chinese subtitles for OpenCC conversion, and fallback
 * languages for machine translation.
 */

const { normalizeLang, toRestCode, toSubsenseCode } = require('./langs');

const DEFAULT_SOURCE = 'https://opensubtitles-v3.strem.io';
const REST_BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'OpenCC-Stremio-Subtitles v1.0';

const REQUEST_TIMEOUT = 10000;
const MANIFEST_TIMEOUT = 8000;

/** Language codes that can possibly be Chinese, used when no filter is set. */
const CHINESE_LANGS = new Set([
	'zht', 'chi', 'zho', 'chs', 'cht', 'zh', 'cn', 'tw', 'hk',
	'zh-cn', 'zh-tw', 'zh-hk', 'zh-hans', 'zh-hant',
]);

/** Splits a comma/space separated allow list into normalised codes. */
function langList(value) {
	return String(value || '')
		.split(/[,\s]+/)
		.map(normalizeLang)
		.filter(Boolean);
}

/** True when `lang` appears in an explicit allow list. */
function langInList(list, lang) {
	const wanted = langList(list);
	const normalized = normalizeLang(lang);
	if (!normalized || !wanted.length) return false;
	return wanted.includes(normalized);
}

/** True when `lang` is an accepted Chinese source subtitle. */
function langAllowed(cfg, lang) {
	const wanted = langList(cfg.langs);
	const normalized = normalizeLang(lang);
	if (!normalized) return false;
	if (!wanted.length) return CHINESE_LANGS.has(normalized);
	return wanted.includes(normalized);
}

/** True when `lang` may be machine translated as a fallback. */
function fallbackAllowed(cfg, lang) {
	return langInList(cfg.fallbackLangs, lang);
}

/**
 * Normalises one upstream URL. People paste whatever their addon's install
 * page gave them: a bare origin, an origin plus that addon's own config
 * segment, or the full manifest URL. All three have to end up as the base the
 * subtitle route is appended to.
 */
function addonBase(input) {
	return String(input || '')
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/manifest\.json$/i, '');
}

/** The configured upstream list, in the order the viewer typed it. */
function sourceList(value) {
	const seen = new Set();
	const bases = [];
	for (const entry of String(value || '').split(/[\s,]+/)) {
		const base = addonBase(entry);
		if (!base || seen.has(base)) continue;
		// Only real HTTP(S) endpoints; anything else would be a typo.
		if (!/^https?:\/\/[^\s]+$/i.test(base)) continue;
		seen.add(base);
		bases.push(base);
	}
	return bases;
}

/** A short, recognisable tag for one upstream (`subsense.nepiraw.com` -> `subsense`). */
function originLabel(base) {
	try {
		const host = new URL(base).hostname.replace(/^www\./i, '');
		// `opensubtitles-v3.strem.io` must stay readable, so the cap only ever
		// trims a genuinely long label and never leaves a dangling separator.
		return host.split('.')[0].slice(0, 20).replace(/[-_.]+$/, '');
	} catch {
		return '';
	}
}

const SUBSENSE_BASE = 'https://subsense.nepiraw.com';

/**
 * Builds a ready-to-paste SubSense base URL.
 *
 * SubSense keeps its whole configuration in the path, as URL-encoded JSON, and
 * answers 404 on a bare origin. The language codes matter more than they look:
 * see `toSubsenseCode` for why an unrecognised one silently yields English.
 */
function subsenseUrl(languages) {
	const codes = [...new Set((languages || []).map(toSubsenseCode).filter(Boolean))];
	if (!codes.length) return SUBSENSE_BASE;
	const config = { languages: codes, maxSubtitles: 25 };
	return `${SUBSENSE_BASE}/${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * Curated upstreams, so a viewer does not have to hunt for install URLs.
 *
 * Every entry was checked against the live service. Only OpenSubtitles v3 works
 * from its bare origin: the rest keep their configuration in the URL and answer
 * 404 (or 500) without it. Those carry a `configure` link instead of a `url` —
 * pretending a bare domain works would only produce an empty picker later — and
 * SubSense gets its URL built here rather than copied out of a screenshot.
 */
const KNOWN_SOURCES = [
	{
		id: 'opensubtitles-v3',
		label: 'OpenSubtitles v3',
		note: '免金鑰、免設定，開箱即用（實測 90 筆）',
		url: DEFAULT_SOURCE,
	},
	{
		id: 'subsense',
		label: 'SubSense',
		note: '免金鑰聚合 OpenSubtitles／SubDL／SubSource 等 10 個來源；網址已依你的語言設定產生',
		build: (cfg) => subsenseUrl(['chi', ...langList(cfg.fallbackLangs)]),
		configure: `${SUBSENSE_BASE}/configure`,
	},
	{
		id: 'subdl',
		label: 'SubDL Subtitles',
		note: '需要 SubDL 的免費 API Key，請先到它的設定頁產生安裝網址',
		configure: 'https://subdl.strem.top/configure',
	},
	{
		id: 'subsource',
		label: 'SubSource Subtitles',
		note: '需要 SubSource 的 API Key，請先到它的設定頁產生安裝網址',
		configure: 'https://subsource.strem.top/configure',
	},
	{
		id: 'stremio-community-subtitles',
		label: 'Stremio Community Subtitles',
		note: '社群上傳的字幕，請先到它的設定頁產生安裝網址',
		configure: 'https://stremio-community-subtitles.top/configure',
	},
];

/** The curated list, with any per-viewer parts already filled in. */
function knownSources(cfg) {
	return KNOWN_SOURCES.map((entry) => ({
		id: entry.id,
		label: entry.label,
		note: entry.note,
		configure: entry.configure || '',
		url: entry.build ? entry.build(cfg) : entry.url || '',
	}));
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

/** Resource names of a manifest, which may use either the string or object form. */
function resourceNames(manifest) {
	return (manifest.resources || [])
		.map((entry) => (typeof entry === 'string' ? entry : entry && entry.name))
		.filter(Boolean);
}

/** Reads an upstream addon's manifest. Also used by the source checker. */
async function fetchManifest(base) {
	const response = await fetch(`${addonBase(base)}/manifest.json`, {
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(MANIFEST_TIMEOUT),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const manifest = await response.json();
	if (!manifest || !manifest.id) throw new Error('回應不是有效的 addon manifest');
	return manifest;
}

/** Asks one upstream addon for its subtitle list. */
async function listFromAddon(base, type, id) {
	const payload = await fetchJson(`${base}/subtitles/${type}/${sanitizeId(id)}.json`);
	const subtitles = (payload && payload.subtitles) || [];
	const origin = originLabel(base);

	return subtitles
		.filter((sub) => sub && sub.url)
		.map((sub) => ({
			id: String(sub.id || sub.url),
			url: sub.url,
			lang: normalizeLang(sub.lang),
			// Addons disagree on what to call a release: OpenSubtitles v3 uses
			// `subtitleFileName`, SubSense uses `fileName`/`releaseName`/`label`.
			// Reading only one of them leaves the picker full of bare numbered
			// rows, which is exactly what the label is meant to avoid.
			name: String(
				sub.subtitleFileName || sub.movieReleaseName || sub.fileName || sub.releaseName || sub.label || ''
			).trim(),
			origin,
		}));
}

/** Builds the REST `languages` query from both allow lists. */
function restLanguages(cfg) {
	const codes = new Set();
	for (const code of [...langList(cfg.langs), ...langList(cfg.fallbackLangs)]) {
		const mapped = toRestCode(code);
		if (mapped) codes.add(mapped);
	}
	if (!codes.size) {
		codes.add('zh-cn');
		codes.add('zh-tw');
	}
	return [...codes].join(',');
}

async function listFromRest(cfg, type, id) {
	if (!cfg.apiKey) {
		throw new Error('OpenSubtitles.com 需要 API Key，請在設定頁填入（或在設定頁改用免金鑰的來源）。');
	}

	const [imdbId, season, episode] = String(id).split(':');
	const numericId = String(imdbId).replace(/^tt/, '');

	const params = new URLSearchParams({ languages: restLanguages(cfg) });
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
		const file = (attributes.files || [])[0];
		if (!file || !file.file_id) continue;
		results.push({
			id: String(file.file_id),
			fileId: file.file_id,
			lang: normalizeLang(attributes.language),
			name: file.file_name || attributes.release || '',
			origin: 'opensubtitles',
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

/**
 * Lists every candidate subtitle for one video, unfiltered.
 *
 * Every configured upstream is queried at the same time and the results are
 * concatenated; one slow or broken source must not hold back the others, so
 * failures are logged and skipped rather than thrown.
 */
async function listSubtitles(cfg, type, id) {
	if (!['movie', 'series'].includes(type)) return [];
	if (cfg.provider === 'rest') return listFromRest(cfg, type, id);

	const bases = sourceList(cfg.sources);
	if (!bases.length) return [];

	const settled = await Promise.allSettled(bases.map((base) => listFromAddon(base, type, id)));
	const items = [];
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			items.push(...result.value);
		} else {
			console.warn(`[sources] ${bases[index]}: ${result.reason && result.reason.message}`);
		}
	});
	return items;
}

module.exports = {
	DEFAULT_SOURCE,
	SUBSENSE_BASE,
	CHINESE_LANGS,
	addonBase,
	sourceList,
	originLabel,
	subsenseUrl,
	knownSources,
	resourceNames,
	fetchManifest,
	listFromAddon,
	listSubtitles,
	resolveDownloadLink,
	normalizeLang,
	langList,
	langInList,
	langAllowed,
	fallbackAllowed,
	restLanguages,
};

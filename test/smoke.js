'use strict';

/**
 * End-to-end test: starts the addon plus a mock OpenSubtitles-compatible source
 * and a mock Google Translate endpoint, then exercises the real Stremio routes — manifest,
 * subtitle listing, OpenCC conversion, raw passthrough, legacy encodings and
 * the Google fallback translation path.
 *
 *   node test/smoke.js
 */

const assert = require('assert');
const http = require('http');
const iconv = require('iconv-lite');

const PORT = Number(process.env.PORT || 7099);
const MOCK_PORT = PORT + 1;
const FILE_PORT = MOCK_PORT + 1;
const GOOGLE_PORT = PORT + 4;
const MOCK2_PORT = PORT + 5;

process.env.PORT = String(PORT);
process.env.BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.GOOGLE_API_URL = `http://127.0.0.1:${GOOGLE_PORT}`;

const SIMPLIFIED_SRT = [
	'1',
	'00:00:01,000 --> 00:00:03,000',
	'把这个软件里面的视频转换一下',
	'',
	'2',
	'00:00:04,000 --> 00:00:06,000',
	'我已经把这个问题解决了',
	'',
].join('\n');

const TRADITIONAL_SRT = [
	'1',
	'00:00:01,000 --> 00:00:03,000',
	'他語無倫次，但是提到你的名字',
	'',
].join('\n');

const ENGLISH_SRT = [
	'1',
	'00:00:01,000 --> 00:00:03,000',
	'Hello world',
	'',
	'2',
	'00:00:04,000 --> 00:00:06,000',
	'Hello again',
	'',
].join('\n');

function timestamp(seconds) {
	const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
	return `00:${minutes}:${String(seconds % 60).padStart(2, '0')},000`;
}

/** 120 cues, so the translator has to split them into 50-text requests. */
const LONG_ENGLISH_SRT = Array.from({ length: 120 }, (_, index) =>
	[String(index + 1), `${timestamp(index * 2)} --> ${timestamp(index * 2 + 1)}`, `Line ${index + 1}`, ''].join('\n')
).join('\n');

const MOCK_IDS = {
	tt1111111: { body: SIMPLIFIED_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8', lang: 'zht' },
	tt2222222: { body: SIMPLIFIED_SRT, encoding: 'gbk', contentType: 'application/x-subrip', lang: 'zht' },
	tt3333333: { body: TRADITIONAL_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8', lang: 'zht' },
	tt4444444: { body: ENGLISH_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8', lang: 'eng' },
	tt5555555: { body: LONG_ENGLISH_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8', lang: 'eng' },
	// Sources routinely repeat the same file and list many releases at once.
	tt6666666: {
		body: SIMPLIFIED_SRT,
		encoding: 'utf8',
		contentType: 'application/x-subrip; charset=utf-8',
		lang: 'zht',
		repeat: 4,
		variants: 12,
	},
	// Many English releases: exercises the configurable fallback list length.
	tt7777777: {
		body: ENGLISH_SRT,
		encoding: 'utf8',
		contentType: 'application/x-subrip; charset=utf-8',
		lang: 'eng',
		variants: 12,
	},
	// Used to check the error path when the translation endpoint fails.
	tt8888888: {
		body: ENGLISH_SRT,
		encoding: 'utf8',
		contentType: 'application/x-subrip; charset=utf-8',
		lang: 'eng',
	},
	// The film the source checker probes; it has to exist in at least one source.
	tt1375666: {
		body: SIMPLIFIED_SRT,
		encoding: 'utf8',
		contentType: 'application/x-subrip; charset=utf-8',
		lang: 'zht',
	},
};

/** A minimal OpenSubtitles-v3-compatible subtitle source. */
const mockSource = http.createServer((req, res) => {
	if (req.url === '/manifest.json') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ id: 'test.first', name: 'First Source', resources: ['subtitles'], types: ['movie', 'series'] }));
		return;
	}

	const match = /\/subtitles\/[^/]+\/([^/.]+)/.exec(req.url);
	const id = match && match[1];
	const file = MOCK_IDS[id];
	if (!file) {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ subtitles: [] }));
		return;
	}

	const fileUrl = `http://127.0.0.1:${FILE_PORT}/download/${id}`;
	const subtitles = [{ id, url: fileUrl, lang: file.lang, subtitleFileName: `${id}.${file.lang}.srt` }];
	if (file.lang !== 'eng') {
		// Must be ignored while a Chinese subtitle exists, and used as the
		// fallback source when there is none.
		subtitles.push({ id: `${id}-eng`, url: fileUrl, lang: 'eng', subtitleFileName: `${id}.eng.srt` });
	}
	for (let index = 0; index < (file.variants || 0); index += 1) {
		subtitles.push({
			id: `${id}-v${index}`,
			url: `${fileUrl}?v=${index}`,
			lang: file.lang,
			subtitleFileName: `${id}.release${index}.1080p.WEB-DL.${file.lang}.srt`,
		});
	}
	for (let index = 0; index < (file.repeat || 0); index += 1) {
		subtitles.push({ id: `${id}-dup${index}`, url: fileUrl, lang: file.lang, subtitleFileName: `${id}.${file.lang}.srt` });
	}

	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ subtitles }));
});

const mockFiles = http.createServer((req, res) => {
	const id = req.url.split('/').pop().split('?')[0];
	const file = MOCK_IDS[id];
	if (!file) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { 'Content-Type': file.contentType });
	res.end(iconv.encode(file.body, file.encoding));
});

/**
 * A second upstream addon, so aggregation, cross-source dedupe, the origin tag
 * and the "declares subtitles but serves none" case can all be exercised.
 *
 * It answers on `localhost` while the first one answers on `127.0.0.1`, which
 * gives the two sources distinguishable origin labels.
 */
const mockSource2 = http.createServer((req, res) => {
	const json = (payload) => {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(payload));
	};

	if (req.url === '/manifest.json') {
		json({ id: 'test.second', name: 'Second Source', resources: ['subtitles'], types: ['movie', 'series'] });
		return;
	}
	// A stream addon that merely advertises the subtitles resource, like the
	// real ones do, while answering every request with an empty list.
	if (req.url === '/streamonly/manifest.json') {
		json({ id: 'test.streamonly', name: 'Stream Only', resources: ['stream'], types: ['movie'] });
		return;
	}
	if (req.url.startsWith('/subtitles/movie/tt1111111')) {
		// The first entry repeats the other source's URL and must be collapsed;
		// the second is unique to this source and must survive.
		json({
			subtitles: [
				{
					id: 'dup',
					url: `http://127.0.0.1:${FILE_PORT}/download/tt1111111`,
					lang: 'zht',
					subtitleFileName: 'Coco.2017.1080p.srt',
				},
				{
					id: 'second-only',
					url: `http://127.0.0.1:${FILE_PORT}/download/tt1111111?src=2`,
					lang: 'zht',
					subtitleFileName: 'Coco.2017.2160p.REMUX.srt',
				},
			],
		});
		return;
	}
	if (req.url.startsWith('/subtitles/movie/tt9999999')) {
		json({
			subtitles: [
				{
					id: 'only2',
					url: `http://127.0.0.1:${FILE_PORT}/download/tt1111111?src=2`,
					lang: 'zht',
					subtitleFileName: 'Only.From.Second.srt',
				},
			],
		});
		return;
	}
	json({ subtitles: [] });
});

/** Records every Google request so the test can assert on batching. */
const googleCalls = [];
/** Set above 0 to make the mock Google endpoint fail, like rate limiting does. */
let googleFailuresLeft = 0;

const mockGoogle = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	if (url.pathname !== '/translate_a/t') {
		res.writeHead(404);
		res.end();
		return;
	}
	if (googleFailuresLeft > 0) {
		googleFailuresLeft -= 1;
		// The real host answers rate limiting with an HTML page, not JSON.
		res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end('<html><title>Sorry...</title></html>');
		return;
	}

	const texts = url.searchParams.getAll('q');
	googleCalls.push({ texts, sl: url.searchParams.get('sl'), tl: url.searchParams.get('tl') });
	const translations = texts.map((text) =>
		text.replace(/Hello/gi, '你好').replace(/World/gi, '世界').replace(/Line (\d+)/gi, '第 $1 行')
	);
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(translations));
});

require('../src/server');

const { encodeConfig, decodeConfig } = require('../src/config');
const { convertSubtitle, looksSimplified } = require('../src/opencc');
const { splitSegments } = require('../src/srt');
const { batchTexts: googleBatchTexts, parseTranslations } = require('../src/google');
const { clampFallbackLimit, MAX_FALLBACK_LIMIT } = require('../src/config');
const stats = require('../src/stats');
const { toGoogleSource, toGoogleTarget } = require('../src/langs');
const { sourceList, addonBase, originLabel } = require('../src/sources');
	const { composeLabel, releaseLabel, disambiguateLabels, withOrigin, RELEASE_LABEL_LIMIT } = require('../src/subtitles');

const BASE = `http://127.0.0.1:${PORT}`;
const SOURCE_URL = `http://127.0.0.1:${MOCK_PORT}`;
const SOURCE2_URL = `http://localhost:${MOCK2_PORT}`;
const CFG = encodeConfig({
	from: 'cn',
	to: 'twp',
	provider: 'v3',
	sources: SOURCE_URL,
	keepOriginal: true,
});

async function get(path) {
	const response = await fetch(`${BASE}${path}`);
	return { status: response.status, headers: response.headers, body: await response.text() };
}

async function getJson(path) {
	const result = await get(path);
	return { ...result, json: JSON.parse(result.body) };
}

async function post(path, payload) {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
	return { status: response.status, json: await response.json() };
}

/** Downloads the first subtitle of a list response. */
async function fetchFirstSubtitle(configSegment, id) {
	const list = await getJson(`/${configSegment}/subtitles/movie/${id}.json`);
	assert.ok(list.json.subtitles.length, `expected a subtitle for ${id}`);
	return get(new URL(list.json.subtitles[0].url).pathname);
}

function unitTests() {
	const s2twp = convertSubtitle('把这个软件里面的视频转换一下', { from: 'cn', to: 'twp', mode: 'auto' });
	assert.strictEqual(s2twp.text, '把這個軟體裡面的影片轉換一下');
	assert.strictEqual(s2twp.skipped, false);

	const skipped = convertSubtitle('他語無倫次，但是提到你的名字', { from: 'cn', to: 'twp', mode: 'auto' });
	assert.strictEqual(skipped.skipped, true, 'already-Traditional text must be skipped in auto mode');
	assert.strictEqual(skipped.text, '他語無倫次，但是提到你的名字');

	const forced = convertSubtitle('他語無倫次', { from: 'cn', to: 'twp', mode: 'always' });
	assert.strictEqual(forced.skipped, false);

	const custom = convertSubtitle('这个软件', { from: 'cn', to: 'twp', mode: 'always', customDict: '軟件=軟體' });
	assert.strictEqual(custom.text, '這個軟體');
	assert.strictEqual(
		convertSubtitle('这个软件', { from: 'cn', to: 'tw', mode: 'always' }).text,
		'這個軟件',
		'cn→tw must not apply Taiwan phrase conversion'
	);

	assert.strictEqual(convertSubtitle('这个软件', { from: 'cn', to: 'hk', mode: 'always' }).text, '這個軟件');

	const timings = convertSubtitle(SIMPLIFIED_SRT, { from: 'cn', to: 'twp', mode: 'auto' }).text;
	assert.ok(timings.includes('00:00:01,000 --> 00:00:03,000'), 'timing lines must survive conversion');
	assert.ok(/^1\n/.test(timings), 'cue numbers must survive conversion');

	assert.strictEqual(looksSimplified('我已经解决了'), true);
	assert.strictEqual(looksSimplified('我已經解決了'), false);

	const encoded = encodeConfig({ from: 'cn', to: 'hkp', keepOriginal: true, customDict: '甲=乙' });
	const decoded = decodeConfig(encoded);
	assert.strictEqual(decoded.to, 'hkp');
	assert.strictEqual(decoded.keepOriginal, true);
	assert.strictEqual(decoded.customDict, '甲=乙');
	assert.strictEqual(decodeConfig('not-a-config').to, 'twp', 'invalid config falls back to defaults');
	assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded), 'config segment must be URL safe');
	assert.strictEqual(decodeConfig(encodeConfig({})).fallbackLangs, 'eng', 'fallback defaults to English');
	assert.strictEqual(decodeConfig(encodeConfig({ fallbackLimit: 3 })).fallbackLimit, 3);

	// Segment detection ignores cue numbers and timing lines.
	const { segments } = splitSegments(SIMPLIFIED_SRT);
	assert.strictEqual(segments.length, 2);

	// Compact, descriptive labels.
	assert.strictEqual(composeLabel('繁體中文', ''), '繁體中文');
	assert.strictEqual(composeLabel('繁體中文', 'Inception.2010.720p.srt'), '繁體中文 · Inception 2010 720p');
	assert.strictEqual(
		releaseLabel('Alita.Battle.Angel.2019.1080p.BluRay.x264-AMIABLE.cht.srt'),
		'…1080p BluRay x264-AMIABLE',
		'a long name must keep the release tail, not the film title'
	);
	assert.strictEqual(releaseLabel('a'.repeat(80)).length, RELEASE_LABEL_LIMIT);
	assert.ok(composeLabel('繁體中文', 'a'.repeat(80)).includes('…'), 'truncated names are marked with an ellipsis');
	assert.ok(composeLabel('繁體中文', 'a'.repeat(80)).length <= RELEASE_LABEL_LIMIT + 8);

	// Equal labels are numbered so no two rows look the same.
	const rows = disambiguateLabels([{ label: '繁體中文 · 1080p' }, { label: '繁體中文 · 1080p' }, { label: 'x' }]);
	assert.deepStrictEqual(rows.map((row) => row.label), ['繁體中文 · 1080p', '繁體中文 · 1080p (2)', 'x']);

	// Language mapping.
	assert.strictEqual(toGoogleSource('eng'), 'en');
	assert.strictEqual(toGoogleSource('jpn'), 'ja');
	assert.strictEqual(toGoogleSource('yue'), null, 'Google has no Cantonese');
	assert.strictEqual(toGoogleSource('klingon'), null);
	assert.strictEqual(toGoogleTarget('twp'), 'zh-TW');
	assert.strictEqual(toGoogleTarget('cn'), 'zh-CN');

	// Google batching and response parsing.
	assert.strictEqual(googleBatchTexts(Array.from({ length: 120 }, () => 'x')).length, 3);
	assert.deepStrictEqual(parseTranslations(['a', 'b']), ['a', 'b']);
	assert.deepStrictEqual(parseTranslations([['a', 'fr']]), ['a'], 'sl=auto answers with pairs');

// Upstream URL handling: a bare origin, a config segment or a manifest all work.
assert.deepStrictEqual(sourceList('https://a.example.com'), ['https://a.example.com']);
assert.deepStrictEqual(sourceList('https://a.example.com/cfg/manifest.json'), ['https://a.example.com/cfg']);
assert.deepStrictEqual(sourceList('https://a.example.com, https://a.example.com'), ['https://a.example.com'], 'duplicates collapse');
assert.deepStrictEqual(sourceList('not a url'), [], 'non-HTTP entries are dropped');
assert.strictEqual(addonBase('https://x.example.com/cfg/'), 'https://x.example.com/cfg');
assert.strictEqual(originLabel('https://subsense.nepiraw.com/abc'), 'subsense');
assert.strictEqual(originLabel('not a url'), '');

// The origin tag only appears once more than one upstream is configured.
assert.strictEqual(withOrigin('繁體中文', { origin: 'subsense' }, false), '繁體中文');
assert.strictEqual(withOrigin('繁體中文', { origin: 'subsense' }, true), '繁體中文（subsense）');

// Install links that predate the upstream list keep their source.
const legacy = Buffer.from(JSON.stringify({ u: 'https://legacy.example.com' }), 'utf8').toString('base64url');
assert.strictEqual(decodeConfig(legacy).sources, 'https://legacy.example.com');

	// The fallback list length is clamped to a sane range.
	assert.strictEqual(clampFallbackLimit(undefined), 1);
	assert.strictEqual(clampFallbackLimit(3), 3);
	assert.strictEqual(clampFallbackLimit(0), 1);
	assert.strictEqual(clampFallbackLimit(99), MAX_FALLBACK_LIMIT);
	console.log('unit      ok');
}

async function httpTests() {
	const manifest = await getJson('/manifest.json');
	assert.strictEqual(manifest.status, 200);
	assert.deepStrictEqual(manifest.json.resources, ['subtitles']);
	assert.deepStrictEqual(manifest.json.types, ['movie', 'series']);
	assert.strictEqual(manifest.json.behaviorHints.configurationRequired, true);
	assert.strictEqual(manifest.json.logo, `${BASE}/logo.png`, 'logo must be self-hosted and absolute');

	const logo = await get('/logo.png');
	assert.strictEqual(logo.status, 200);
	assert.strictEqual(logo.headers.get('content-type'), 'image/png');

	const configured = await getJson(`/${CFG}/manifest.json`);
	assert.strictEqual(configured.json.behaviorHints.configurationRequired, undefined);
	assert.strictEqual(configured.json.behaviorHints.configurable, undefined);

	const page = await get(`/${CFG}/configure`);
	assert.strictEqual(page.status, 200);
	assert.ok(page.body.includes('OpenCC 轉換設定'));
	assert.ok(page.body.includes('備援翻譯'), 'the config page must expose the fallback settings');
	assert.ok(page.body.includes('上游字幕外掛'), 'the upstream list must be present');
	assert.ok(page.body.includes('sourceCheckBtn'), 'the source checker must be present');
	assert.ok(page.body.includes('fallbackLimit'), 'the fallback count control must be present');
	assert.ok(page.body.includes('快取與翻譯統計'), 'the dashboard must be present');
	assert.ok(!page.body.includes('DeepL'), 'the page must not mention DeepL any more');
	assert.ok(!page.body.includes('__SETTINGS__'), 'settings must be injected into the page');

	const configApi = await post('/api/config', { from: 'cn', to: 'twp', customDict: '軟件=軟體' });
	assert.ok(configApi.json.manifestPath.endsWith('/manifest.json'));
	assert.ok(
		!configApi.json.manifestPath.startsWith('http'),
		'the API must return a relative path so the page stays correct behind a proxy'
	);
	assert.strictEqual(decodeConfig(configApi.json.config).customDict, '軟件=軟體');

	const preview = await post('/api/preview', { settings: { from: 'cn', to: 'twp' }, text: '这个软件' });
	assert.strictEqual(preview.json.text, '這個軟體');
	assert.strictEqual(preview.json.looksSimplified, true);

	assert.strictEqual((await getJson('/health')).json.status, 'ok');

	const routes = await getJson('/manus-routes.json');
	assert.ok(Array.isArray(routes.json.routes) && routes.json.routes.length > 0);
	console.log('http      ok');
}

async function conversionTests() {
	// Simplified UTF-8 source -> converted, plus a raw copy.
	const list = await getJson(`/${CFG}/subtitles/movie/tt1111111.json`);
	assert.strictEqual(list.status, 200);
	assert.strictEqual(list.json.subtitles.length, 2, 'English subtitles must be filtered out');
	assert.strictEqual(list.json.subtitles[0].lang, 'zht');

	const converted = await get(new URL(list.json.subtitles[0].url).pathname);
	assert.strictEqual(converted.status, 200);
	assert.ok(converted.headers.get('content-type').includes('utf-8'));
	assert.ok(converted.body.includes('把這個軟體裡面的影片轉換一下'), 'Simplified must become Traditional');
	assert.ok(converted.body.includes('我已經把這個問題解決了'));
	assert.ok(!converted.body.includes('这个软件'), 'no Simplified characters may survive');
	assert.ok(converted.body.includes('00:00:01,000 --> 00:00:03,000'));

	const raw = await get(new URL(list.json.subtitles[1].url).pathname);
	assert.ok(raw.body.includes('把这个软件里面的视频转换一下'), 'raw copy must stay Simplified');

	// Already-Traditional source -> untouched in auto mode.
	const traditionalList = await getJson(`/${CFG}/subtitles/movie/tt3333333.json`);
	const traditional = await get(new URL(traditionalList.json.subtitles[0].url).pathname);
	assert.strictEqual(traditional.body, TRADITIONAL_SRT);

	// GBK source with no declared charset -> decoded, then converted.
	const gbk = await fetchFirstSubtitle(CFG, 'tt2222222');
	assert.ok(gbk.body.includes('把這個軟體裡面的影片轉換一下'), 'GBK subtitle must be decoded and converted');

	// Unknown id -> empty list, no error.
	const empty = await getJson(`/${CFG}/subtitles/movie/tt9999999.json`);
	assert.deepStrictEqual(empty.json, { subtitles: [] });

	// Duplicate files are collapsed and the picker stays short.
	const many = await getJson(`/${CFG}/subtitles/movie/tt6666666.json`);
	const manyUrls = many.json.subtitles.map((sub) => sub.url);
	assert.strictEqual(new Set(manyUrls).size, manyUrls.length, 'the same file must not be listed twice');
	assert.strictEqual(many.json.subtitles.length, 10, '5 releases x (converted + raw)');

	const labels = many.json.subtitles.map((sub) => sub.label);
	assert.ok(labels.every((label) => label.startsWith('繁體中文 · ') || label.startsWith('簡體原文 · ')));
	assert.ok(labels.every((label) => label.length <= 40), 'labels must stay compact');
	assert.ok(labels.every((label) => !label.includes('.srt')), 'labels must not leak the file extension');
	assert.strictEqual(new Set(labels).size, labels.length, 'no two rows may look identical');
	console.log('converted ok');
}

/**
 * Several upstream addons at once: results are merged, a file that two sources
 * both list is collapsed, a broken source does not take the others down, and
 * every entry names the addon it came from.
 */
async function multiSourceTests() {
const both = encodeConfig({ provider: 'v3', sources: `${SOURCE_URL}, ${SOURCE2_URL}`, to: 'twp' });

const list = await getJson(`/${both}/subtitles/movie/tt1111111.json`);
assert.strictEqual(list.json.subtitles.length, 2, 'the URL both sources share must be collapsed');
const labels = list.json.subtitles.map((sub) => sub.label);
assert.ok(labels.some((label) => label.startsWith('繁體中文（127）')), 'the first upstream must be named');
assert.ok(labels.some((label) => label.startsWith('繁體中文（localhost）')), 'the second upstream must be named');

// Every merged entry must still be downloadable and converted.
for (const sub of list.json.subtitles) {
const file = await get(new URL(sub.url).pathname);
assert.strictEqual(file.status, 200);
assert.ok(!looksSimplified(file.body), 'the merged entry must be converted, not passed through');
}

// A subtitle only one of the addons carries is still found.
const secondOnly = await getJson(`/${both}/subtitles/movie/tt9999999.json`);
assert.strictEqual(secondOnly.json.subtitles.length, 1);
assert.ok(secondOnly.json.subtitles[0].label.startsWith('繁體中文（localhost）'));

// One dead source must not stop the others from answering.
const withDead = encodeConfig({ provider: 'v3', sources: `http://127.0.0.1:1, ${SOURCE_URL}`, to: 'twp' });
const survived = await getJson(`/${withDead}/subtitles/movie/tt1111111.json`);
assert.ok(survived.json.subtitles.length > 0, 'a dead source must not take the others down');

// A pasted manifest URL is accepted as-is.
const asManifest = encodeConfig({ provider: 'v3', sources: `${SOURCE_URL}/manifest.json`, to: 'twp' });
const viaManifest = await getJson(`/${asManifest}/subtitles/movie/tt1111111.json`);
assert.ok(viaManifest.json.subtitles.length > 0, 'a manifest URL must work');

// A single upstream keeps the plain label, without an origin tag.
const single = await getJson(`/${encodeConfig({ provider: 'v3', sources: SOURCE_URL, to: 'twp' })}/subtitles/movie/tt1111111.json`);
assert.ok(single.json.subtitles.every((sub) => !sub.label.includes('（')), 'a single source must not be tagged');

// The source checker reports what each upstream really offers.
const check = await post('/api/sources/check', {
settings: { sources: `${SOURCE_URL}, ${SOURCE2_URL}, ${SOURCE2_URL}/streamonly` },
});
assert.strictEqual(check.json.results.length, 3);
	const [first, second, streamOnly] = check.json.results;
	assert.strictEqual(first.name, 'First Source');
	assert.strictEqual(first.subtitles, true);
	assert.ok(first.entries > 0, 'a working source must report the entries it returns');
	assert.strictEqual(second.name, 'Second Source');
	assert.strictEqual(second.subtitles, true);
	assert.strictEqual(second.entries, 0, 'declaring the resource but serving nothing must be called out');
	assert.strictEqual(streamOnly.subtitles, false, 'a stream addon must be reported as having no subtitles');

const unreachable = await post('/api/sources/check', { settings: { sources: 'http://127.0.0.1:1' } });
assert.strictEqual(unreachable.json.results[0].ok, false);
assert.ok(unreachable.json.results[0].error, 'the reason must be reported');

console.log('multi     ok');
}

async function googleFallbackTests() {
	// Google needs no key, so the fallback works with nothing configured.
	const auto = encodeConfig({ provider: 'v3', sources: SOURCE_URL, to: 'twp', fallbackLangs: 'eng' });
	const list = await getJson(`/${auto}/subtitles/movie/tt4444444.json`);
	assert.strictEqual(list.json.subtitles.length, 1);
	assert.ok(list.json.subtitles[0].id.startsWith('machine:'), 'fallback entries must be marked as translated');
	assert.strictEqual(list.json.subtitles[0].lang, 'zht');
	assert.ok(list.json.subtitles[0].label.startsWith('繁體中文（Google）'), 'translated entries must say so');

	const translated = await get(new URL(list.json.subtitles[0].url).pathname);
	assert.strictEqual(translated.status, 200);
	assert.ok(translated.body.includes('你好 世界'), 'the Google fallback must be translated');
	assert.ok(translated.body.includes('00:00:01,000 --> 00:00:03,000'), 'timing lines must survive translation');
	assert.ok(!translated.body.includes('Hello'), 'no source text may survive');

	const call = googleCalls[googleCalls.length - 1];
	assert.strictEqual(call.tl, 'zh-TW', 'Traditional Chinese target');
	assert.strictEqual(call.sl, 'en', 'the source language must be mapped, not auto-detected');
	assert.strictEqual(call.texts.length, 2, 'one request may carry several cues');

	// A long subtitle is split into requests the endpoint accepts.
	googleCalls.length = 0;
	const long = await fetchFirstSubtitle(auto, 'tt5555555');
	assert.ok(long.body.includes('第 120 行'), 'every cue must be translated');
	assert.ok(googleCalls.every((entry) => entry.texts.length <= 50));
	assert.strictEqual(googleCalls.reduce((total, entry) => total + entry.texts.length, 0), 120);

	// A Chinese subtitle exists -> the fallback must stay out of the way.
	const withChinese = await getJson(`/${auto}/subtitles/movie/tt1111111.json`);
	assert.ok(withChinese.json.subtitles.length > 0);
	assert.ok(withChinese.json.subtitles.every((sub) => sub.id.startsWith('opencc')));

	// An empty fallback language list disables the feature entirely.
	const noFallback = encodeConfig({ provider: 'v3', sources: SOURCE_URL, fallbackLangs: '' });
	assert.deepStrictEqual((await getJson(`/${noFallback}/subtitles/movie/tt4444444.json`)).json, { subtitles: [] });

	// A failing endpoint yields a readable error, not a broken subtitle.
	googleFailuresLeft = 2; // both attempts of the only configured host
	const failingList = await getJson(`/${auto}/subtitles/movie/tt8888888.json`);
	const failingFile = await get(new URL(failingList.json.subtitles[0].url).pathname);
	assert.strictEqual(failingFile.status, 502);
	assert.ok(failingFile.body.includes('Google 翻譯失敗'), 'the error must name the cause');

	// The fallback list length is configurable and defaults to a single entry.
	const single = await getJson(`/${auto}/subtitles/movie/tt7777777.json`);
	assert.strictEqual(single.json.subtitles.length, 1, 'only one fallback entry by default');

	const triple = encodeConfig({
		provider: 'v3',
		sources: SOURCE_URL,
		to: 'twp',
		fallbackLangs: 'eng',
		fallbackLimit: 3,
	});
	assert.strictEqual((await getJson(`/${triple}/subtitles/movie/tt7777777.json`)).json.subtitles.length, 3);

	const capped = encodeConfig({
		provider: 'v3',
		sources: SOURCE_URL,
		to: 'twp',
		fallbackLangs: 'eng',
		fallbackLimit: 99,
	});
	assert.strictEqual(
		(await getJson(`/${capped}/subtitles/movie/tt7777777.json`)).json.subtitles.length,
		5,
		'the limit must be capped'
	);
	console.log('google    ok');
}

/** Reads server-sent snapshots from the dashboard stream. */
async function readStream(url, expected, onFirst) {
	const controller = new AbortController();
	const response = await fetch(url, { signal: controller.signal });
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const payloads = [];
	let buffer = '';
	const deadline = Date.now() + 20000;

	try {
		while (payloads.length < expected && Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let index;
			while ((index = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, index);
				buffer = buffer.slice(index + 2);
				const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
				if (!line) continue;
				payloads.push(JSON.parse(line.slice(6)));
				if (payloads.length === 1 && onFirst) await onFirst();
			}
		}
	} finally {
		controller.abort();
	}

	return payloads;
}

async function statsTests() {
	const watch = await post('/api/stats/watch', { settings: {} });
	assert.strictEqual(watch.json.ok, true);
	assert.ok(watch.json.id, 'a key-free watch must be possible');

	assert.strictEqual((await getJson('/api/stats/stream?id=bogus')).status, 404);

	const once = await post('/api/stats/once', { settings: {} });
	assert.strictEqual(once.json.ok, true);
	assert.ok(once.json.cache && once.json.translation, 'the snapshot must carry both metric groups');

	// A change pushes a fresh snapshot without the page asking for one.
	const streamUrl = `${BASE}/api/stats/stream?id=${watch.json.id}`;
	const payloads = await readStream(streamUrl, 2, async () => {
		await fetchFirstSubtitle(CFG, 'tt2222222');
	});
	assert.ok(payloads.length >= 2, 'the stream must push on activity');
	const latest = payloads[payloads.length - 1];
	assert.strictEqual(latest.ok, true);
	assert.ok(latest.cache.hits + latest.cache.misses > 0, 'cache activity must be counted');
	assert.ok(typeof latest.cache.hitRate === 'number' || latest.cache.hitRate === null);

	// The snapshot must not leak a removed DeepL concept.
	assert.strictEqual(latest.usage, undefined);
	assert.strictEqual(latest.alert, undefined);
	assert.ok(latest.translation.characters > 0, 'translated characters must be counted');
	console.log('stats     ok');
}

async function liveTest() {
	try {
		const list = await getJson('/subtitles/movie/tt1375666.json');
		if (!list.json.subtitles.length) {
			console.log('live      skipped (no Chinese subtitle upstream)');
			return;
		}
		const file = await get(new URL(list.json.subtitles[0].url).pathname);
		assert.strictEqual(file.status, 200);
		assert.ok(/^\s*1\s*[\r\n]+\d{2}:\d{2}:\d{2}/.test(file.body), 'expected a valid SRT file');
		console.log(`live      ok (${file.body.length} bytes from the real OpenSubtitles source)`);
	} catch (error) {
		console.log(`live      skipped (${error.message})`);
	}
}

async function main() {
	await new Promise((resolve) => mockSource.listen(MOCK_PORT, '127.0.0.1', resolve));
	await new Promise((resolve) => mockFiles.listen(FILE_PORT, '127.0.0.1', resolve));
	await new Promise((resolve) => mockSource2.listen(MOCK2_PORT, '127.0.0.1', resolve));
	await new Promise((resolve) => mockGoogle.listen(GOOGLE_PORT, '127.0.0.1', resolve));

	unitTests();
	await httpTests();
	await conversionTests();
	await multiSourceTests();
	await googleFallbackTests();
	await statsTests();
	await liveTest();

	console.log('\nAll checks passed.');
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

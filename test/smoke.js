'use strict';

/**
 * End-to-end test: starts the addon plus a mock OpenSubtitles-compatible source
 * and a mock DeepL server, then exercises the real Stremio routes — manifest,
 * subtitle listing, OpenCC conversion, raw passthrough, legacy encodings and
 * the DeepL fallback translation path.
 *
 *   node test/smoke.js
 */

const assert = require('assert');
const http = require('http');
const iconv = require('iconv-lite');

const PORT = Number(process.env.PORT || 7099);
const MOCK_PORT = PORT + 1;
const FILE_PORT = MOCK_PORT + 1;
const DEEPL_PORT = PORT + 3;
const DEEPL_KEY = 'test-key:fx';

process.env.PORT = String(PORT);
process.env.BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.DEEPL_API_URL = `http://127.0.0.1:${DEEPL_PORT}`;

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
};

/** A minimal OpenSubtitles-v3-compatible subtitle source. */
const mockSource = http.createServer((req, res) => {
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
		// Must be ignored while a Chinese subtitle exists, and used as the DeepL
		// fallback source when there is none.
		subtitles.push({ id: `${id}-eng`, url: fileUrl, lang: 'eng', subtitleFileName: `${id}.eng.srt` });
	}

	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ subtitles }));
});

const mockFiles = http.createServer((req, res) => {
	const id = req.url.split('/').pop();
	const file = MOCK_IDS[id];
	if (!file) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { 'Content-Type': file.contentType });
	res.end(iconv.encode(file.body, file.encoding));
});

/** Records every translate request so the test can assert on batching. */
const deeplCalls = [];

const mockDeepl = http.createServer((req, res) => {
	if ((req.headers.authorization || '') !== `DeepL-Auth-Key ${DEEPL_KEY}`) {
		res.writeHead(403, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ message: 'Authorization failed' }));
		return;
	}

	if (req.url === '/v2/usage') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ character_count: 1234, character_limit: 500000 }));
		return;
	}

	if (req.url === '/v2/translate' && req.method === 'POST') {
		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			const payload = JSON.parse(body);
			deeplCalls.push(payload);
			const translations = payload.text.map((text) =>
				text.replace(/Hello/gi, '你好').replace(/World/gi, '世界').replace(/Line (\d+)/gi, '第 $1 行')
			);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }));
		});
		return;
	}

	res.writeHead(404);
	res.end();
});

require('../src/server');

const { encodeConfig, decodeConfig } = require('../src/config');
const { convertSubtitle, looksSimplified } = require('../src/opencc');
const { batchTexts, splitSegments, apiHost } = require('../src/deepl');
const { toDeepLSource, toDeepLTarget } = require('../src/langs');

const BASE = `http://127.0.0.1:${PORT}`;
const SOURCE_URL = `http://127.0.0.1:${MOCK_PORT}`;
const CFG = encodeConfig({
	from: 'cn',
	to: 'twp',
	provider: 'v3',
	sourceUrl: SOURCE_URL,
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
	assert.strictEqual(decodeConfig(encodeConfig({ deeplKey: 'k:fx' })).deeplKey, 'k:fx');

	// Language mapping.
	assert.strictEqual(toDeepLSource('eng'), 'EN');
	assert.strictEqual(toDeepLSource('jpn'), 'JA');
	assert.strictEqual(toDeepLSource('zh-tw'), 'ZH');
	assert.strictEqual(toDeepLSource('klingon'), null);
	assert.strictEqual(toDeepLTarget('twp'), 'ZH-HANT');
	assert.strictEqual(toDeepLTarget('cn'), 'ZH-HANS');

	// Free keys end in `:fx` and live on a different host. The override that
	// points this suite at its mock server has to be lifted for that check.
	const override = process.env.DEEPL_API_URL;
	delete process.env.DEEPL_API_URL;
	assert.strictEqual(apiHost('abc:fx'), 'https://api-free.deepl.com');
	assert.strictEqual(apiHost('abc'), 'https://api.deepl.com');
	process.env.DEEPL_API_URL = override;

	// Segment detection ignores cue numbers and timing lines.
	const { segments } = splitSegments(SIMPLIFIED_SRT);
	assert.strictEqual(segments.length, 2);

	// Batching respects the 50-text limit.
	assert.strictEqual(batchTexts(Array.from({ length: 120 }, () => 'x')).length, 3);
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
	assert.ok(page.body.includes('DeepL 備援翻譯'), 'the config page must expose the DeepL settings');
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
	console.log('converted ok');
}

async function deeplTests() {
	const withKey = encodeConfig({
		provider: 'v3',
		sourceUrl: SOURCE_URL,
		to: 'twp',
		deeplKey: DEEPL_KEY,
		fallbackLangs: 'eng',
	});

	// No Chinese subtitle exists -> the fallback is offered.
	const list = await getJson(`/${withKey}/subtitles/movie/tt4444444.json`);
	assert.strictEqual(list.json.subtitles.length, 1);
	assert.ok(list.json.subtitles[0].id.startsWith('deepl:'), 'fallback entries must be marked as translated');
	assert.strictEqual(list.json.subtitles[0].lang, 'zht');

	const translated = await get(new URL(list.json.subtitles[0].url).pathname);
	assert.strictEqual(translated.status, 200);
	assert.ok(translated.body.includes('你好 世界'), 'the fallback subtitle must be translated');
	assert.ok(translated.body.includes('00:00:01,000 --> 00:00:03,000'), 'timing lines must survive translation');
	assert.ok(!translated.body.includes('Hello'), 'no source text may survive');

	// A Chinese subtitle exists -> the fallback must stay out of the way.
	const withChinese = await getJson(`/${withKey}/subtitles/movie/tt1111111.json`);
	assert.ok(withChinese.json.subtitles.length > 0);
	assert.ok(withChinese.json.subtitles.every((sub) => sub.id.startsWith('opencc')));

	// No key -> no fallback entries.
	const withoutKey = encodeConfig({ provider: 'v3', sourceUrl: SOURCE_URL, fallbackLangs: 'eng' });
	assert.deepStrictEqual((await getJson(`/${withoutKey}/subtitles/movie/tt4444444.json`)).json, { subtitles: [] });

	// Empty fallback list -> no fallback entries either.
	const withoutFallback = encodeConfig({ provider: 'v3', sourceUrl: SOURCE_URL, deeplKey: DEEPL_KEY, fallbackLangs: '' });
	assert.deepStrictEqual((await getJson(`/${withoutFallback}/subtitles/movie/tt4444444.json`)).json, { subtitles: [] });

	// A long subtitle is split into requests DeepL accepts.
	deeplCalls.length = 0;
	const long = await fetchFirstSubtitle(withKey, 'tt5555555');
	assert.ok(long.body.includes('第 1 行') && long.body.includes('第 120 行'), 'every cue must be translated');
	assert.strictEqual(deeplCalls.length, 3, '120 cues must become 3 DeepL requests');
	assert.ok(deeplCalls.every((call) => call.text.length <= 50), 'never more than 50 texts per request');
	assert.ok(deeplCalls.every((call) => call.target_lang === 'ZH-HANT'));
	assert.ok(deeplCalls.every((call) => call.source_lang === 'EN'));
	assert.strictEqual(deeplCalls.reduce((total, call) => total + call.text.length, 0), 120);

	// A rejected key produces a readable error instead of a broken subtitle.
	const badKey = encodeConfig({ provider: 'v3', sourceUrl: SOURCE_URL, deeplKey: 'not-a-key', fallbackLangs: 'eng' });
	const bad = await fetchFirstSubtitle(badKey, 'tt4444444');
	assert.strictEqual(bad.status, 402);
	assert.ok(bad.body.includes('DeepL'), 'the error must name DeepL so the cause is obvious');

	// Key/usage check used by the config page.
	const usage = await post('/api/deepl-usage', { settings: { deeplKey: DEEPL_KEY } });
	assert.strictEqual(usage.json.ok, true);
	assert.strictEqual(usage.json.characterLimit, 500000);
	assert.strictEqual(usage.json.percent, 0);

	const badUsage = await post('/api/deepl-usage', { settings: { deeplKey: 'not-a-key' } });
	assert.strictEqual(badUsage.json.ok, false);
	assert.ok(badUsage.json.error.includes('DeepL'));

	const noKeyUsage = await post('/api/deepl-usage', { settings: {} });
	assert.strictEqual(noKeyUsage.json.ok, false);
	console.log('deepl     ok');
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
	await new Promise((resolve) => mockDeepl.listen(DEEPL_PORT, '127.0.0.1', resolve));

	unitTests();
	await httpTests();
	await conversionTests();
	await deeplTests();
	await liveTest();

	console.log('\nAll checks passed.');
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

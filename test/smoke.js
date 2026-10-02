'use strict';

/**
 * End-to-end test: starts the addon plus a mock OpenSubtitles-compatible source
 * and exercises the real Stremio routes — manifest, subtitle listing, converted
 * download, raw passthrough and legacy-encoding handling.
 *
 *   node test/smoke.js
 */

const assert = require('assert');
const http = require('http');
const iconv = require('iconv-lite');

const PORT = Number(process.env.PORT || 7099);
const MOCK_PORT = PORT + 1;

process.env.PORT = String(PORT);
process.env.BASE_URL = `http://127.0.0.1:${PORT}`;

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

const MOCK_IDS = {
	tt1111111: { body: SIMPLIFIED_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8' },
	tt2222222: { body: SIMPLIFIED_SRT, encoding: 'gbk', contentType: 'application/x-subrip' },
	tt3333333: { body: TRADITIONAL_SRT, encoding: 'utf8', contentType: 'application/x-subrip; charset=utf-8' },
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
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(
		JSON.stringify({
			subtitles: [
				{
					id: id,
					url: `http://127.0.0.1:${MOCK_PORT + 1}/download/${id}`,
					lang: 'zht',
					subtitleFileName: `${id}.cht.srt`,
				},
				// Must be ignored: not a Chinese language code.
				{ id: `${id}-eng`, url: `http://127.0.0.1:${MOCK_PORT + 1}/download/${id}`, lang: 'eng' },
			],
		})
	);
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

require('../src/server');

const { encodeConfig, decodeConfig } = require('../src/config');
const { convertSubtitle, looksSimplified } = require('../src/opencc');

const BASE = `http://127.0.0.1:${PORT}`;
const CFG = encodeConfig({
	from: 'cn',
	to: 'twp',
	provider: 'v3',
	sourceUrl: `http://127.0.0.1:${MOCK_PORT}`,
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
	const gbkList = await getJson(`/${CFG}/subtitles/movie/tt2222222.json`);
	const gbk = await get(new URL(gbkList.json.subtitles[0].url).pathname);
	assert.ok(gbk.body.includes('把這個軟體裡面的影片轉換一下'), 'GBK subtitle must be decoded and converted');

	// Unknown id -> empty list, no error.
	const empty = await getJson(`/${CFG}/subtitles/movie/tt9999999.json`);
	assert.deepStrictEqual(empty.json, { subtitles: [] });
	console.log('converted ok');
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
	await new Promise((resolve) => mockFiles.listen(MOCK_PORT + 1, '127.0.0.1', resolve));

	unitTests();
	await httpTests();
	await conversionTests();
	await liveTest();

	console.log('\nAll checks passed.');
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

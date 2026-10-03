'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const { DEFAULTS, encodeConfig, normalizeConfig, decodeConfig } = require('./config');
const { manifestForConfig } = require('./manifest');
const { LOCALES, PAIRS, targetsFor, looksSimplified, convertSubtitle } = require('./opencc');
const { buildSubtitleFile } = require('./subtitle-file');
const { handleSubtitles } = require('./subtitles');
const { sourceList, fetchManifest, resourceNames, listFromAddon, knownSources } = require('./sources');
const stats = require('./stats');
const SIMPLIFIED_CHARS = require('./data/simplified-chars');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const CONFIGURE_HTML = fs
	.readFileSync(path.join(PUBLIC_DIR, 'configure.html'), 'utf8')
	.replace('/*__SETTINGS__*/null', () =>
		JSON.stringify({ defaults: DEFAULTS, locales: LOCALES, pairs: PAIRS, simplifiedChars: SIMPLIFIED_CHARS })
	);

function baseUrlFor(req) {
	if (process.env.BASE_URL) return String(process.env.BASE_URL).replace(/\/+$/, '');
	// Behind the hosting platform's proxy the request Host is an internal one,
	// so prefer the forwarded public host/protocol when present.
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const host = forwardedHost || req.headers.host;
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
	return `${proto}://${host}`;
}

function send(res, status, body, headers = {}) {
	res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
	res.end(body);
}

function sendJson(res, status, payload) {
	send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit = 64 * 1024) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error('request body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

async function handleSubtitlesRequest(req, res, config, type, id, baseUrl) {
	try {
		const result = await handleSubtitles({ type, id, config, baseUrl });
		sendJson(res, 200, result);
	} catch (error) {
		console.error(`[subtitles] ${type}/${id} failed:`, error.message);
		sendJson(res, 200, { subtitles: [] });
	}
}

async function handleSubtitleFile(res, config, token) {
	try {
		const cfg = decodeConfig(config);
		const file = await buildSubtitleFile({ cfg, token, configSegment: config || 'default' });
		send(res, 200, file.body, {
			'Content-Type': file.contentType,
			'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
			'Cache-Control': 'public, max-age=3600',
		});
	} catch (error) {
		console.error('[subtitle-file]', error.message);
		send(res, error.statusCode || 502, `# ${error.message}\n`, { 'Content-Type': 'text/plain; charset=utf-8' });
	}
}

/** POST /api/config – single source of truth for encoding settings into a URL. */
async function handleConfigApi(req, res, baseUrl) {
	let payload;
	try {
		payload = JSON.parse((await readBody(req)) || '{}');
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}

	// Accept both a flat settings object and one wrapped in `settings`, so the
	// endpoint stays usable from scripts as well as from the page.
	const cfg = normalizeConfig(payload.settings || payload);
	const encoded = encodeConfig(cfg);

	// Only a relative path is returned: the configuration page composes the
	// absolute URLs from its own origin, which stays correct behind a proxy.
	sendJson(res, 200, {
		config: encoded,
		settings: cfg,
		manifestPath: `/${encoded}/manifest.json`,
		configurePath: `/${encoded}/configure`,
	});
}

/** POST /api/preview – converts a snippet with the given settings. */
async function handlePreviewApi(req, res) {
	let payload;
	try {
		payload = JSON.parse((await readBody(req)) || '{}');
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}

	const cfg = normalizeConfig(payload.settings || {});
	const sample = String(payload.text || '');
	const result = convertSubtitle(sample, cfg);

	sendJson(res, 200, {
		text: result.text,
		skipped: result.skipped,
		convertedLines: result.convertedLines,
		totalLines: result.totalLines,
		looksSimplified: looksSimplified(sample),
		targets: targetsFor(cfg.from),
	});
}

/**
 * A widely available film, so an empty answer says something about the addon
 * rather than about the title.
 */
const PROBE_ID = 'tt1375666';
const PROBE_TYPE = 'movie';

/**
 * POST /api/sources/check – reports what each configured upstream really offers.
 *
 * Declaring the `subtitles` resource in a manifest does not mean the addon
 * returns anything for it: stream addons commonly advertise the resource and
 * then answer every request with an empty list. So the manifest is only the
 * first half of the check — each source is then asked for one known film, and
 * the number of entries it actually returns is what decides whether it is
 * worth keeping.
 */
async function handleSourcesCheck(req, res) {
	let payload;
	try {
		payload = JSON.parse((await readBody(req)) || '{}');
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}

	const cfg = normalizeConfig(payload.settings || payload);
	const results = await Promise.all(
		sourceList(cfg.sources).map(async (base) => {
			const entry = { base };
			try {
				const manifest = await fetchManifest(base);
				const resources = resourceNames(manifest);
				entry.ok = true;
				entry.id = manifest.id;
				entry.name = manifest.name || manifest.id;
				entry.subtitles = resources.includes('subtitles');
				entry.resources = resources;
			} catch (error) {
				entry.ok = false;
				entry.error = error.message;
				return entry;
			}
			if (!entry.subtitles) return entry;

			try {
				entry.entries = (await listFromAddon(base, PROBE_TYPE, PROBE_ID)).length;
			} catch (error) {
				entry.entries = null;
				entry.probeError = error.message;
				// A configurable addon answers 404 (or 500) on its bare origin
				// because its settings live in the URL. Without saying so, the
				// viewer reads a status code as an outage and gives up on a
				// perfectly good addon.
				entry.needsConfig = /HTTP (400|403|404|500)/.test(error.message);
			}
			return entry;
		})
	);

	sendJson(res, 200, { ok: true, probeId: PROBE_ID, results });
}

/**
 * POST /api/sources/presets – the curated upstream list, with any per-viewer
 * parts already filled in (SubSense's URL carries the chosen languages).
 */
async function handleSourcesPresets(req, res) {
	let payload;
	try {
		payload = JSON.parse((await readBody(req)) || '{}');
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}
	sendJson(res, 200, { ok: true, sources: knownSources(normalizeConfig(payload.settings || payload)) });
}

/* ------------------------------------------------------------------ *
 * Live dashboard
 *
 * The page never polls: it registers a watch, then receives server-sent
 * snapshots whenever a metric changes.
 * ------------------------------------------------------------------ */

const STREAM_KEEPALIVE = 20000;
/** Coalesces bursts (a player can request several subtitles at once). */
const STREAM_PUSH_DELAY = 400;

function statsPayload() {
	return { ok: true, error: null, ...stats.snapshot() };
}

async function readSettings(req) {
	const payload = JSON.parse((await readBody(req)) || '{}');
	return normalizeConfig(payload.settings || payload || {});
}

/** POST /api/stats/watch – registers a short-lived stream handle. */
async function handleStatsWatch(req, res) {
	try {
		await readSettings(req);
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}

	sendJson(res, 200, { ok: true, id: stats.createWatch({}) });
}

/** POST /api/stats/once – one-shot snapshot, used when streaming is unavailable. */
async function handleStatsOnce(req, res) {
	try {
		await readSettings(req);
	} catch {
		return sendJson(res, 400, { error: 'invalid JSON body' });
	}

	sendJson(res, 200, statsPayload());
}

/** GET /api/stats/stream?id=… – server-sent snapshot stream. */
function handleStatsStream(req, res, url) {
	const watch = stats.getWatch(url.searchParams.get('id'));
	if (!watch) return sendJson(res, 404, { ok: false, error: 'unknown watch' });

	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		// Ask intermediary proxies not to buffer the stream.
		'X-Accel-Buffering': 'no',
	});
	res.write(': open\n\n');

	let pushTimer = null;
	let closed = false;

	const push = () => {
		if (closed) return;
		res.write(`data: ${JSON.stringify(statsPayload())}\n\n`);
	};
	const schedulePush = () => {
		if (closed || pushTimer) return;
		pushTimer = setTimeout(() => {
			pushTimer = null;
			push();
		}, STREAM_PUSH_DELAY);
	};

	push();
	const unsubscribe = stats.subscribe(schedulePush);
	const keepalive = setInterval(() => {
		if (!closed) res.write(': keepalive\n\n');
	}, STREAM_KEEPALIVE);

	const close = () => {
		if (closed) return;
		closed = true;
		clearInterval(keepalive);
		if (pushTimer) clearTimeout(pushTimer);
		unsubscribe();
		res.end();
	};
	req.on('close', close);
	res.on('close', close);
}

const server = http.createServer(async (req, res) => {
	if (req.method === 'OPTIONS') {
		return send(res, 204, '', {
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		});
	}

	const baseUrl = baseUrlFor(req);
	const url = new URL(req.url, baseUrl);
	const segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));

	try {
		// POST endpoints for the configuration page.
		if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'config') {
			return handleConfigApi(req, res, baseUrl);
		}
		if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'preview') {
			return handlePreviewApi(req, res);
		}
		if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'sources' && segments[2] === 'check') {
			return handleSourcesCheck(req, res);
		}
		if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'sources' && segments[2] === 'presets') {
			return handleSourcesPresets(req, res);
		}
		if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'sources' && segments[2] === 'presets') {
			return handleSourcesPresets(req, res);
		}
		if (segments[0] === 'api' && segments[1] === 'stats') {
			if (req.method === 'GET' && segments[2] === 'stream') {
				return handleStatsStream(req, res, url);
			}
			if (req.method === 'POST' && segments[2] === 'watch') {
				return handleStatsWatch(req, res);
			}
			if (req.method === 'POST' && segments[2] === 'once') {
				return handleStatsOnce(req, res);
			}
		}
		if (segments[0] === 'health') {
			return sendJson(res, 200, { status: 'ok', manifest: `${baseUrl}/manifest.json` });
		}

		if (segments.length === 1 && segments[0] === 'logo.png') {
			return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'logo.png')), {
				'Content-Type': 'image/png',
				'Cache-Control': 'public, max-age=86400',
			});
		}

		// Page route manifest consumed by the hosting platform.
		if (segments.length === 1 && segments[0] === 'manus-routes.json') {
			return sendJson(res, 200, {
				routes: [
					{ path: '/', title: '設定' },
					{ path: '/configure', title: '設定' },
				],
			});
		}

		// Converted subtitle file: /srt/<config>/<token>.srt
		if (segments[0] === 'srt' && segments.length === 3) {
			return handleSubtitleFile(res, segments[1], segments[2].replace(/\.(srt|vtt)$/i, ''));
		}

		// Configuration page: /configure and /<config>/configure
		if (segments.length === 0 || segments[0] === 'configure') {
			return send(res, 200, CONFIGURE_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
		}
		if (segments.length === 2 && segments[1] === 'configure') {
			return send(res, 200, CONFIGURE_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
		}

		// Manifest: /manifest.json and /<config>/manifest.json
		if (segments.length === 1 && segments[0] === 'manifest.json') {
			return sendJson(res, 200, manifestForConfig(false, baseUrl));
		}
		if (segments.length === 2 && segments[1] === 'manifest.json') {
			return sendJson(res, 200, manifestForConfig(Boolean(segments[0]), baseUrl));
		}

		// Subtitles resource: /subtitles/<type>/<id>.json and /<config>/subtitles/<type>/<id>.json
		const resourceIndex = segments.indexOf('subtitles');
		if (resourceIndex === 0 || resourceIndex === 1) {
			const config = resourceIndex === 1 ? segments[0] : '';
			const type = segments[resourceIndex + 1];
			const id = (segments[resourceIndex + 2] || '').replace(/\.json$/i, '');
			if (type && id) return handleSubtitlesRequest(req, res, config, type, id, baseUrl);
		}

		sendJson(res, 404, { error: 'not found' });
	} catch (error) {
		console.error('[server]', error);
		sendJson(res, 500, { error: 'internal error' });
	}
});

server.listen(PORT, HOST, () => {
	console.log(`OpenCC Stremio addon listening on http://${HOST}:${PORT}`);
	console.log(`  Manifest   : http://127.0.0.1:${PORT}/manifest.json`);
	console.log(`  Configure  : http://127.0.0.1:${PORT}/configure`);
});

module.exports = server;

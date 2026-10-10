'use strict';

/**
 * Two request logs, answering two different questions.
 *
 * 1. `recordRequest` — what the client *sent* on a subtitle request. The extra
 *    arguments carry the file hash, its size and its name, which are the only
 *    way to tell which release is playing and therefore which subtitle will
 *    have timing that lines up.
 *
 * 2. `recordHit` — every request of any kind, with its User-Agent and status.
 *    This answers "did the client reach us at all, and as what". It is the
 *    question to ask when an addon works in one Stremio client and not in
 *    another, because a client that never connects leaves no other trace.
 *
 * Both are in memory only: these are diagnostics, not user data. The platform's
 * published logs carry the same information and outlive a container restart,
 * which is why every request is also written to stdout.
 */

/** How many recent subtitle requests to keep for the config page. */
const HISTORY_LIMIT = 20;

/** How many recent requests of any kind to keep. */
const HIT_LIMIT = 50;

const history = [];
const hits = [];

function truncate(value, limit) {
	const text = String(value == null ? '' : value);
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** The desktop platform a QtWebEngine build is running on. */
function desktopPlatform(userAgent) {
	if (/windows/i.test(userAgent)) return 'Windows';
	if (/macintosh|mac os/i.test(userAgent)) return 'macOS';
	if (/linux|x11/i.test(userAgent)) return 'Linux';
	return '桌面';
}

/**
 * Names the client behind a User-Agent.
 *
 * The Stremio desktop app is the whole reason this exists: it identifies itself
 * as a bare `QtWebEngine/5.15.2 Chrome/…` string with the word "stremio"
 * nowhere in it, so a plain search for the app's name concludes that no desktop
 * client has ever connected while that client is in fact asking for subtitles.
 * Each branch below therefore matches what a client really sends, and the
 * QtWebEngine branch has to come first because that string also contains
 * "Chrome" and "Safari".
 */
function clientLabel(userAgent) {
	const ua = String(userAgent || '');
	if (!ua) return '未知';
	if (/QtWebEngine/i.test(ua)) return `Stremio 桌面版（${desktopPlatform(ua)}）`;
	if (/stremio/i.test(ua)) return 'Stremio';
	if (/okhttp|exoplayer|dalvik|android/i.test(ua)) return 'Stremio Android';
	if (/curl|wget/i.test(ua)) return 'curl';
	if (/cfworkers-deployer|warm-ping|cravatar|uptime/i.test(ua)) return '平台檢查';
	if (/mozilla/i.test(ua)) return '瀏覽器';
	return '其他';
}

/**
 * Parses the `key=value&key=value` segment into an object.
 *
 * The segment arrives percent-encoded, and the trailing `.json` of the whole
 * route can end up attached to its last value, so both are cleaned off.
 */
function parseExtras(segment) {
	const extras = {};
	if (!segment) return extras;

	for (const pair of String(segment).split('&')) {
		const index = pair.indexOf('=');
		if (index === -1) continue;
		const key = pair.slice(0, index).trim();
		if (!key) continue;
		let value = pair.slice(index + 1);
		value = value.replace(/\.json$/i, '');
		try {
			extras[key] = decodeURIComponent(value.replace(/\+/g, ' '));
		} catch {
			extras[key] = value;
		}
	}
	return extras;
}

/**
 * Records one subtitle request so the config page can show what the client
 * actually sends.
 */
function recordRequest({ path, extras, type, id, config, userAgent }) {
	history.unshift({
		at: new Date().toISOString(),
		path: truncate(path, 300),
		type,
		id,
		config: config ? config.slice(0, 24) : '',
		userAgent: truncate(userAgent, 120),
		client: clientLabel(userAgent),
		extras: extras || {},
		keys: Object.keys(extras || {}).sort(),
	});
	if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

/**
 * Records every request the server receives, whatever the route.
 *
 * `kind` is a coarse label (manifest, subtitles, subtitle-file, config-page…)
 * so the list stays readable without having to parse the path by eye.
 */
function recordHit({ method, path, kind, userAgent, status, durationMs }) {
	hits.unshift({
		at: new Date().toISOString(),
		method,
		path: truncate(path, 300),
		kind,
		userAgent: truncate(userAgent, 120),
		client: clientLabel(userAgent),
		status,
		durationMs,
	});
	if (hits.length > HIT_LIMIT) hits.length = HIT_LIMIT;
}

/** Recent subtitle requests, newest first. */
function recentRequests() {
	return history;
}

/** Recent requests of any kind, newest first. */
function recentHits() {
	return hits;
}

module.exports = {
	parseExtras,
	clientLabel,
	recordRequest,
	recentRequests,
	recordHit,
	recentHits,
	HISTORY_LIMIT,
	HIT_LIMIT,
};

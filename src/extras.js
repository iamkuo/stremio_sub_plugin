'use strict';

/**
 * The extra arguments Stremio appends to resource requests.
 *
 * The protocol carries them as a query string glued into the path:
 *
 *   /subtitles/movie/tt1375666/videoHash=8e245…&videoSize=1632…&filename=…json
 *
 * For subtitles those arguments matter more than for any other resource: the
 * file hash, its size and its name are the only way to tell *which release* is
 * playing, and therefore the only way to pick a subtitle whose timing lines up.
 *
 * Whether a given client actually sends them is not guaranteed — that depends
 * on the app and its version — so every request is recorded here and shown on
 * the config page. That turns "does Stremio send the filename?" from a guess
 * into something you can look at.
 */

/** How many recent requests to remember for the config page. */
const HISTORY_LIMIT = 20;

const history = [];

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
 * actually sends. Kept in memory only: this is a diagnostic, not user data.
 */
function recordRequest({ path, extras, type, id, config }) {
	history.unshift({
		at: new Date().toISOString(),
		path,
		type,
		id,
		config: config ? config.slice(0, 24) : '',
		extras: extras || {},
		keys: Object.keys(extras || {}).sort(),
	});
	if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

/** Recent requests, newest first. */
function recentRequests() {
	return history;
}

module.exports = { parseExtras, recordRequest, recentRequests, HISTORY_LIMIT };

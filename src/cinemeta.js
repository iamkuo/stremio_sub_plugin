'use strict';

/**
 * Film runtime lookup, used only by the frame-rate correction.
 *
 * The runtime is the yardstick that says whether a subtitle runs to the end of
 * the film or stops short of it. Cinemeta is Stremio's own metadata addon, so
 * the lookup needs no key and answers for the same IMDb ids the addon already
 * receives.
 *
 * The value is rounded to whole minutes upstream, which is why the frame-rate
 * check that consumes it is written to be conservative (see src/fps.js).
 */

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TIMEOUT = 6000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;

const cache = new Map();

/** `"2h 28min"`, `"148 min"`, `"52min"`, `148` -> minutes. */
function parseRuntimeMinutes(value) {
	if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : 0;
	const text = String(value || '').toLowerCase().trim();
	if (!text) return 0;

	const hours = /(\d+)\s*h/.exec(text);
	const minutes = /(\d+)\s*m/.exec(text);
	if (hours || minutes) {
		return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
	}
	const bare = /^(\d+)$/.exec(text);
	return bare ? Number(bare[1]) : 0;
}

function cacheGet(key) {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.at > CACHE_TTL) {
		cache.delete(key);
		return null;
	}
	return entry.value;
}

function cacheSet(key, value) {
	cache.set(key, { at: Date.now(), value });
	if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/**
 * Runtime of the item being played, in seconds; 0 when it is unknown.
 *
 * `id` may be a plain movie id (`tt1375666`) or a series episode
 * (`tt0944947:1:1`), in which case the episode's own runtime is preferred over
 * the series average.
 */
async function fetchRuntimeSeconds(type, id) {
	const [baseId, season, episode] = String(id || '').split(':');
	if (!baseId) return 0;

	const key = `${type}:${id}`;
	const cached = cacheGet(key);
	if (cached !== null) return cached;

	let seconds = 0;
	try {
		const response = await fetch(`${CINEMETA_BASE}/meta/${type}/${baseId}.json`, {
			signal: AbortSignal.timeout(TIMEOUT),
		});
		if (response.ok) {
			const meta = (await response.json()).meta || {};
			let minutes = 0;

			if (season && episode) {
				const videos = Array.isArray(meta.videos) ? meta.videos : [];
				const wanted =
					videos.find((video) => video.id === id) ||
					videos.find(
						(video) => String(video.season) === String(season) && String(video.episode) === String(episode)
					);
				minutes = parseRuntimeMinutes(wanted && wanted.runtime);
			}
			if (!minutes) minutes = parseRuntimeMinutes(meta.runtime);
			if (minutes) seconds = minutes * 60;
		}
	} catch {
		// A missing runtime only disables one heuristic; it is never fatal.
		seconds = 0;
	}

	cacheSet(key, seconds);
	return seconds;
}

module.exports = { fetchRuntimeSeconds, parseRuntimeMinutes, runtimeCacheSize: () => cache.size };

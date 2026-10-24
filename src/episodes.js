'use strict';

/**
 * Episode numbering, translated.
 *
 * Anime is numbered two ways at once. Releases and anime catalogs count the
 * whole run: 藥師少女的獨語 episode 49. Metadata sources count by season: season
 * 3, episode 1. Both describe the same episode, and a client can ask with
 * either — which is how a viewer ends up with a subtitle list built from one
 * source that happens to answer the other numbering while every source that
 * indexes the episode properly is never asked.
 *
 * Observed: a client asked for `tt26743760:1:49`, a season with 24 episodes, so
 * OpenSubtitles v3 and SubSense both answered "no subtitles" and the only list
 * on screen came from the one source that matched anyway — whose downloads were
 * returning HTTP 500. The episode the viewer actually wanted, season 3 episode
 * 1, was sitting in OpenSubtitles v3 with a Traditional Chinese file all along.
 *
 * Cinemeta is Stremio's own metadata addon and already answers for the ids the
 * addon receives, so the mapping needs no key.
 */

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TIMEOUT = 6000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;

const cache = new Map();

/** `tt26743760:1:49` -> base id, season, episode. */
const SERIES_ID = /^(.+):(\d+):(\d+)$/;

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
 * Groups a series' episodes by season.
 *
 * @returns {{ seasons: Map<number, number[]>, run: Array<{season:number,episode:number}> }}
 *   `seasons` holds every season as metadata lists it, specials included, and
 *   answers "does this episode exist?". `run` is the broadcast order that
 *   absolute numbering counts, so it deliberately skips season 0: specials sit
 *   outside the run, and counting them would shift every later episode.
 */
function buildEpisodeIndex(videos) {
	const seasons = new Map();
	for (const video of Array.isArray(videos) ? videos : []) {
		const season = Number(video && video.season);
		const episode = Number(video && video.episode);
		if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
		if (!seasons.has(season)) seasons.set(season, new Set());
		seasons.get(season).add(episode);
	}

	const sorted = new Map();
	for (const [season, episodes] of seasons) sorted.set(season, [...episodes].sort((a, b) => a - b));

	const run = [];
	for (const season of [...sorted.keys()].filter((value) => value >= 1).sort((a, b) => a - b)) {
		for (const episode of sorted.get(season)) run.push({ season, episode });
	}
	return { seasons: sorted, run };
}

/** Every episode of a series, in broadcast order; cached for six hours. */
async function fetchEpisodeIndex(baseId) {
	const cached = cacheGet(baseId);
	if (cached) return cached;

	let index = { seasons: new Map(), run: [] };
	let answered = false;
	try {
		const response = await fetch(`${CINEMETA_BASE}/meta/series/${encodeURIComponent(baseId)}.json`, {
			signal: AbortSignal.timeout(TIMEOUT),
		});
		if (response.ok) {
			const meta = (await response.json()).meta || {};
			index = buildEpisodeIndex(meta.videos);
			answered = true;
		}
	} catch {
		// Without metadata the numbering cannot be translated. The id is used
		// as it came, which is the behaviour that existed before this module.
	}

	// Only a real answer is worth remembering. Caching a failed lookup would
	// freeze "this series has no episodes" for six hours over one bad minute.
	if (answered) cacheSet(baseId, index);
	return index;
}

/**
 * The episode an absolute number points at, or null when it points nowhere.
 *
 * @param {{run: Array<{season:number,episode:number}>}} index
 * @param {number} absolute 1-based position in the broadcast run.
 */
function absoluteTarget(index, absolute) {
	if (!index || !Array.isArray(index.run)) return null;
	if (!Number.isInteger(absolute) || absolute < 1) return null;
	return index.run[absolute - 1] || null;
}

/**
 * Other ids that may name the same episode as this one.
 *
 * Only called for a series id whose season Cinemeta knows and whose episode
 * number is outside that season. Anything else is left alone: an unknown season
 * must not be guessed at, because a later season that metadata has not caught up
 * with would otherwise be "translated" into an early episode of season 1.
 *
 * @returns {Promise<string[]>} ids to query in addition to the one given.
 */
async function numberingAlternatives(type, id) {
	if (type !== 'series') return [];

	const match = SERIES_ID.exec(String(id || ''));
	if (!match) return [];
	const [, baseId, seasonText, episodeText] = match;
	const season = Number(seasonText);
	const episode = Number(episodeText);

	const index = await fetchEpisodeIndex(baseId);
	if (!index.run.length) return [];

	const episodesOfSeason = index.seasons.get(season);
	if (!episodesOfSeason) return [];
	if (episodesOfSeason.includes(episode)) return [];
	if (season === 0) return [];

	const target = absoluteTarget(index, episode);
	if (!target) return [];
	if (target.season === season && target.episode === episode) return [];

	return [`${baseId}:${target.season}:${target.episode}`];
}

module.exports = {
	numberingAlternatives,
	fetchEpisodeIndex,
	buildEpisodeIndex,
	absoluteTarget,
	episodeCacheSize: () => cache.size,
};

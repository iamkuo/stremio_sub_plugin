'use strict';

/**
 * Runtime metrics for the usage dashboard.
 *
 * Two very different kinds of number live here:
 *
 *  - DeepL's own account usage, which is authoritative, survives restarts and
 *    is fetched from `/v2/usage` (it does not consume translation quota).
 *  - Process-local counters (cache hits, characters translated by this
 *    container). These reset whenever the container is replaced, so they are
 *    always reported as "since this process started" rather than as a month.
 *
 * Subscribers are notified through an event bus so the dashboard can be pushed
 * updates instead of polling.
 */

const { EventEmitter } = require('events');
const { randomBytes } = require('crypto');

/** How long a fetched DeepL usage snapshot is considered current. */
const USAGE_TTL = 60 * 1000;
/** Watch registrations only need to outlive the page that created them. */
const WATCH_TTL = 10 * 60 * 1000;

const WARN_PERCENT = 80;
const CRITICAL_PERCENT = 95;
/** Used for the estimate until this process has translated something. */
const FALLBACK_SUBTITLE_CHARACTERS = 40000;

const bus = new EventEmitter();
bus.setMaxListeners(0);

const startedAt = Date.now();

const counters = {
	translationSubtitles: 0,
	translationCharacters: 0,
	translationRequests: 0,
	translationErrors: 0,
	cacheHits: 0,
	cacheMisses: 0,
	cacheCharactersSaved: 0,
	cacheEntries: 0,
	lastTranslationAt: null,
	lastError: null,
	lastProvider: null,
};

/** Per-provider totals, so the dashboard can show where quota is going. */
const providerCounters = {};

let usage = null;
let usageFetchedAt = 0;
let usageError = null;

function emitChange() {
	bus.emit('change');
}

/** Subscribes to metric changes. Returns an unsubscribe function. */
function subscribe(listener) {
	bus.on('change', listener);
	return () => bus.off('change', listener);
}

function recordTranslation({ characters = 0, requests = 0, provider = null }) {
	counters.translationSubtitles += 1;
	counters.translationCharacters += characters;
	counters.translationRequests += requests;
	counters.lastTranslationAt = new Date().toISOString();
	counters.lastError = null;
	counters.lastProvider = provider;
	if (provider) {
		if (!providerCounters[provider]) providerCounters[provider] = { subtitles: 0, characters: 0 };
		providerCounters[provider].subtitles += 1;
		providerCounters[provider].characters += characters;
	}
	emitChange();
}

function recordTranslationError(message) {
	counters.translationErrors += 1;
	counters.lastError = message;
	emitChange();
}

function recordCacheHit(charactersSaved = 0) {
	counters.cacheHits += 1;
	counters.cacheCharactersSaved += charactersSaved;
	emitChange();
}

function recordCacheMiss() {
	counters.cacheMisses += 1;
	emitChange();
}

function recordCacheEntries(size) {
	counters.cacheEntries = size;
}

function setUsage(next) {
	usage = next;
	usageFetchedAt = Date.now();
	usageError = null;
	emitChange();
}

function setUsageError(message) {
	usageError = message;
	usageFetchedAt = Date.now();
	emitChange();
}

function usageIsFresh() {
	return Boolean(usage) && Date.now() - usageFetchedAt < USAGE_TTL;
}

/** Average characters per translated subtitle, used for the remaining estimate. */
function averageSubtitleCharacters() {
	if (counters.translationSubtitles > 0) {
		return Math.max(1, Math.round(counters.translationCharacters / counters.translationSubtitles));
	}
	return FALLBACK_SUBTITLE_CHARACTERS;
}

/** Builds the warning shown on the dashboard when quota runs low. */
function alertFor(current) {
	if (!current || !current.characterLimit) return { level: 'unknown', message: '' };
	const percent = current.percent;
	if (percent >= CRITICAL_PERCENT) {
		return {
			level: 'critical',
			message: `DeepL 額度幾乎用盡（已用 ${percent}%），備援翻譯隨時會失敗。`,
		};
	}
	if (percent >= WARN_PERCENT) {
		return {
			level: 'warn',
			message: `DeepL 額度已用 ${percent}%，剩餘 ${(current.characterLimit - current.characterCount).toLocaleString('en-US')} 字元。`,
		};
	}
	return { level: 'ok', message: '' };
}

/** A JSON-safe view of everything the dashboard shows. */
function snapshot() {
	const remaining = usage && usage.characterLimit ? Math.max(0, usage.characterLimit - usage.characterCount) : null;
	const requests = counters.cacheHits + counters.cacheMisses;
	const average = averageSubtitleCharacters();

	return {
		startedAt: new Date(startedAt).toISOString(),
		uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
		usage: usage
			? {
					...usage,
					remaining,
					fetchedAt: new Date(usageFetchedAt).toISOString(),
					ageSeconds: Math.round((Date.now() - usageFetchedAt) / 1000),
				}
			: null,
		usageError,
		cache: {
			hits: counters.cacheHits,
			misses: counters.cacheMisses,
			entries: counters.cacheEntries,
			hitRate: requests ? Math.round((counters.cacheHits / requests) * 1000) / 10 : null,
			charactersSaved: counters.cacheCharactersSaved,
		},
		translation: {
			subtitles: counters.translationSubtitles,
			characters: counters.translationCharacters,
			requests: counters.translationRequests,
			errors: counters.translationErrors,
			averageSubtitleCharacters: average,
			estimatedRemainingSubtitles: remaining === null ? null : Math.floor(remaining / average),
			lastTranslationAt: counters.lastTranslationAt,
			lastError: counters.lastError,
			lastProvider: counters.lastProvider,
			byProvider: providerCounters,
		},
		alert: alertFor(usage),
		thresholds: { warnPercent: WARN_PERCENT, criticalPercent: CRITICAL_PERCENT },
	};
}

/** Only for tests. */
function reset() {
	for (const key of Object.keys(counters)) {
		counters[key] = typeof counters[key] === 'number' ? 0 : null;
	}
	usage = null;
	usageFetchedAt = 0;
	usageError = null;
	for (const key of Object.keys(providerCounters)) delete providerCounters[key];
}

/* ------------------------------------------------------------------ *
 * Watch registrations
 *
 * EventSource can only issue GET requests, and putting a DeepL key in a
 * query string would leak it into proxy logs. The page therefore registers a
 * watch first and only the opaque id travels in the stream URL.
 * ------------------------------------------------------------------ */

const watches = new Map();

function pruneWatches() {
	const now = Date.now();
	for (const [id, watch] of watches) {
		if (watch.expires <= now) watches.delete(id);
	}
}

function createWatch(settings) {
	pruneWatches();
	const id = randomBytes(16).toString('hex');
	watches.set(id, { settings, expires: Date.now() + WATCH_TTL });
	return id;
}

function getWatch(id) {
	pruneWatches();
	return watches.get(String(id || '')) || null;
}

module.exports = {
	subscribe,
	snapshot,
	reset,
	recordTranslation,
	recordTranslationError,
	recordCacheHit,
	recordCacheMiss,
	recordCacheEntries,
	setUsage,
	setUsageError,
	usageIsFresh,
	createWatch,
	getWatch,
	USAGE_TTL,
	WARN_PERCENT,
	CRITICAL_PERCENT,
};

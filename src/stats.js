'use strict';

/**
 * Runtime metrics for the dashboard.
 *
 * Everything here is process-local: cache hits and the characters this
 * container has translated. Counters reset whenever the container is replaced,
 * so they are always presented as "since this process started" rather than as
 * a monthly total.
 *
 * Subscribers are notified through an event bus, which lets the dashboard be
 * pushed updates instead of polling.
 */

const { EventEmitter } = require('events');
const { randomBytes } = require('crypto');

/** Watch registrations only need to outlive the page that created them. */
const WATCH_TTL = 10 * 60 * 1000;

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
};

function emitChange() {
	bus.emit('change');
}

/** Subscribes to metric changes. Returns an unsubscribe function. */
function subscribe(listener) {
	bus.on('change', listener);
	return () => bus.off('change', listener);
}

function recordTranslation({ characters = 0, requests = 0 }) {
	counters.translationSubtitles += 1;
	counters.translationCharacters += characters;
	counters.translationRequests += requests;
	counters.lastTranslationAt = new Date().toISOString();
	counters.lastError = null;
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

/** A JSON-safe view of everything the dashboard shows. */
function snapshot() {
	const requests = counters.cacheHits + counters.cacheMisses;

	return {
		startedAt: new Date(startedAt).toISOString(),
		uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
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
			lastTranslationAt: counters.lastTranslationAt,
			lastError: counters.lastError,
		},
	};
}

/** Only for tests. */
function reset() {
	for (const key of Object.keys(counters)) {
		counters[key] = typeof counters[key] === 'number' ? 0 : null;
	}
}

/* ------------------------------------------------------------------ *
 * Watch registrations
 *
 * EventSource can only issue GET requests, and the dashboard settings should
 * not have to travel in a query string. The page therefore registers a watch
 * first and only the opaque id travels in the stream URL.
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
	createWatch,
	getWatch,
	WATCH_TTL,
};

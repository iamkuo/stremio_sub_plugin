'use strict';

/**
 * Opaque handles for the converted-subtitle endpoint. A token only ever
 * describes *which* upstream file to fetch (`u` = direct URL, `f` =
 * OpenSubtitles.com file id, `n` = file name, `r` = serve the raw original).
 * The conversion settings always come from the config segment of the URL.
 */
function encodeToken(data) {
	const compact = {};
	if (data.u) compact.u = data.u;
	if (data.f) compact.f = data.f;
	if (data.n) compact.n = data.n;
	if (data.r) compact.r = 1;
	return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function decodeToken(token) {
	try {
		const raw = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
		if (!raw || typeof raw !== 'object') return null;
		return { url: raw.u, fileId: raw.f, name: raw.n, raw: raw.r === 1 };
	} catch {
		return null;
	}
}

module.exports = { encodeToken, decodeToken };

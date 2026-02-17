// API key generation and hashing utilities
const crypto = require('crypto');

const PREFIX = 'pbx_';

/**
 * Generate a new API key: prefix + 48 random bytes as base64url
 * Returns the plaintext key — store only the hash.
 * @returns {string}
 */
function generateApiKey() {
    const random = crypto.randomBytes(48).toString('base64url');
    return `${PREFIX}${random}`;
}

/**
 * Hash an API key using SHA-256 for storage / lookup.
 * SHA-256 is appropriate here because API keys are high-entropy
 * (48 random bytes) and need to be verified on every request.
 * @param {string} key - Plaintext API key
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

module.exports = {
    generateApiKey,
    hashApiKey,
};

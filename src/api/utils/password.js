// Password hashing utilities using bcrypt
const bcrypt = require('bcryptjs');

const COST_FACTOR = 12;

/**
 * Hash a plaintext password
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, COST_FACTOR);
}

/**
 * Verify a plaintext password against a bcrypt hash
 * @param {string} plaintext
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

module.exports = {
  hashPassword,
  verifyPassword,
};

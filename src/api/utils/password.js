// Password hashing utilities using bcrypt
const bcrypt = require('bcryptjs');

const COST_FACTOR = 12;

const RULES = [
  { test: (p) => p.length >= 8,            message: 'at least 8 characters' },
  { test: (p) => /[A-Z]/.test(p),          message: 'at least one uppercase letter' },
  { test: (p) => /[a-z]/.test(p),          message: 'at least one lowercase letter' },
  { test: (p) => /[0-9]/.test(p),          message: 'at least one number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p),  message: 'at least one special character' },
];

/**
 * Check password strength against policy rules.
 * @param {string} plaintext
 * @returns {{ valid: boolean, failures: string[] }}
 */
function checkPasswordStrength(plaintext) {
  const failures = RULES.filter(r => !r.test(plaintext)).map(r => r.message);
  return { valid: failures.length === 0, failures };
}

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
    checkPasswordStrength,
};

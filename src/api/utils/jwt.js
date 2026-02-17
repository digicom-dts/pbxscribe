// JWT utilities
const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRY = '24h';

/**
 * Generate a signed JWT for a user
 * @param {{ sub: string, email: string, name: string }} payload
 * @returns {string} Signed JWT
 */
function generateToken({sub, email, name}) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is not set');

    return jwt.sign(
        {sub, email, name},
        secret,
        {expiresIn: DEFAULT_EXPIRY}
    );
}

/**
 * Verify and decode a JWT
 * @param {string} token
 * @returns {{ sub: string, email: string, name: string, iat: number, exp: number }}
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is not set');

    return jwt.verify(token, secret);
}

module.exports = {
    generateToken,
    verifyToken,
};

// Auth middleware plugin
const fp = require('fastify-plugin');
const { verifyToken } = require('../utils/jwt');
const { hashApiKey } = require('../utils/apiKey');
const { findActiveCredentialByHash, updateLastUsed } = require('../repositories/credentialRepository');
const { findUserById } = require('../repositories/userRepository');

async function authPlugin(fastify) {
  // Decorate every request with a null user by default
  fastify.decorateRequest('user', null);

  /**
   * preHandler that enforces authentication.
   * Supports:
   *   Authorization: Bearer <jwt>
   *   Authorization: ApiKey <plaintext-key>
   *
   * On success: sets request.user and returns.
   * On failure: replies 401 and returns (Fastify will not call the route handler).
   */
  fastify.decorate('authenticate', async function authenticate(request, reply) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.status(401).send({
        error: { message: 'Authorization header required', statusCode: 401 },
      });
    }

    const spaceIndex = authHeader.indexOf(' ');
    const scheme = spaceIndex === -1 ? authHeader : authHeader.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? '' : authHeader.slice(spaceIndex + 1);

    if (scheme === 'Bearer') {
      let decoded;
      try {
        decoded = verifyToken(value);
      } catch {
        return reply.status(401).send({
          error: { message: 'Invalid or expired token', statusCode: 401 },
        });
      }

      const user = await findUserById(fastify.pg, decoded.sub);
      if (!user || user.status !== 'active') {
        return reply.status(401).send({
          error: { message: 'User not found or inactive', statusCode: 401 },
        });
      }

      request.user = user;
      return;
    }

    if (scheme === 'ApiKey') {
      const hash = hashApiKey(value);
      const result = await findActiveCredentialByHash(fastify.pg, hash, 'api_key');

      if (!result) {
        return reply.status(401).send({
          error: { message: 'Invalid or revoked API key', statusCode: 401 },
        });
      }

      // Fire-and-forget — tracking failure must not block the request
      updateLastUsed(fastify.pg, result.credential.id).catch(() => {});

      request.user = result.user;
      return;
    }

    return reply.status(401).send({
      error: { message: 'Unsupported auth scheme. Use Bearer or ApiKey', statusCode: 401 },
    });
  });
}

module.exports = fp(authPlugin, { name: 'auth', dependencies: ['database'] });

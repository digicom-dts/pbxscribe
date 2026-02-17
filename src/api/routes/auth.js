// Auth routes
const { createUser, findUserByEmail, findUserById } = require('../repositories/userRepository');
const {
  createCredential,
  findCredentialsByUserId,
  findActiveCredentialByHash,
  deactivateCredential,
  updateLastUsed,
} = require('../repositories/credentialRepository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateApiKey, hashApiKey } = require('../utils/apiKey');
const { generateToken, verifyToken } = require('../utils/jwt');

/**
 * Resolve the authenticated user from an Authorization header value.
 * Supports:
 *   Bearer <jwt>
 *   ApiKey <plaintext-key>
 *
 * Returns { user, credentialId } or throws with a status-ready error.
 */
async function resolveAuth(pool, authHeader) {
  if (!authHeader) {
    const err = new Error('Authorization header required');
    err.statusCode = 401;
    throw err;
  }

  const [scheme, value] = authHeader.split(' ');

  if (scheme === 'Bearer') {
    let decoded;
    try {
      decoded = verifyToken(value);
    } catch {
      const err = new Error('Invalid or expired token');
      err.statusCode = 401;
      throw err;
    }

    const user = await findUserById(pool, decoded.sub);
    if (!user || user.status !== 'active') {
      const err = new Error('User not found or inactive');
      err.statusCode = 401;
      throw err;
    }
    return { user, credentialId: null };
  }

  if (scheme === 'ApiKey') {
    const hash = hashApiKey(value);
    const result = await findActiveCredentialByHash(pool, hash, 'api_key');
    if (!result) {
      const err = new Error('Invalid or revoked API key');
      err.statusCode = 401;
      throw err;
    }
    // Fire-and-forget last used update
    updateLastUsed(pool, result.credential.id).catch(() => {});
    return { user: result.user, credentialId: result.credential.id };
  }

  const err = new Error('Unsupported auth scheme. Use Bearer or ApiKey');
  err.statusCode = 401;
  throw err;
}

/**
 * Register auth routes
 * @param {FastifyInstance} fastify
 */
async function authRoutes(fastify) {
  // POST /auth/register
  fastify.post('/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, name, password } = request.body;

    let user;
    try {
      user = await createUser(fastify.pg, { email, name });
    } catch (error) {
      if (error.code === '23505') {
        return reply.status(409).send({
          error: { message: 'A user with this email already exists', statusCode: 409 },
        });
      }
      throw error;
    }

    let token = null;
    if (password) {
      const hash = await hashPassword(password);
      await createCredential(fastify.pg, {
        userId: user.id,
        credentialType: 'password',
        credentialHash: hash,
        label: 'password',
      });
      token = generateToken({ sub: user.id, email: user.email, name: user.name });
    }

    const response = { user };
    if (token) response.token = token;

    return reply.status(201).send(response);
  });

  // POST /auth/login
  fastify.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;
    const genericError = {
      error: { message: 'Invalid credentials', statusCode: 401 },
    };

    const user = await findUserByEmail(fastify.pg, email);
    if (!user || user.status !== 'active') {
      return reply.status(401).send(genericError);
    }

    const credentials = await findCredentialsByUserId(fastify.pg, user.id, 'password');
    const active = credentials.filter(c => c.is_active);

    let matchedCredential = null;
    for (const cred of active) {
      // We need the hash — fetch it directly
      const row = await fastify.pg.query(
        'SELECT credential_hash FROM user_credentials WHERE id = $1',
        [cred.id]
      );
      if (row.rows.length && await verifyPassword(password, row.rows[0].credential_hash)) {
        matchedCredential = cred;
        break;
      }
    }

    if (!matchedCredential) {
      return reply.status(401).send(genericError);
    }

    // Fire-and-forget last used update
    updateLastUsed(fastify.pg, matchedCredential.id).catch(() => {});

    const token = generateToken({ sub: user.id, email: user.email, name: user.name });
    return { token, user };
  });

  // GET /auth/me
  fastify.get('/auth/me', async (request, reply) => {
    let resolved;
    try {
      resolved = await resolveAuth(fastify.pg, request.headers.authorization);
    } catch (err) {
      return reply.status(err.statusCode || 401).send({
        error: { message: err.message, statusCode: err.statusCode || 401 },
      });
    }
    return resolved.user;
  });

  // POST /auth/api-keys — create a new API key for the authenticated user
  fastify.post('/auth/api-keys', {
    schema: {
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 100 },
          expires_in_days: { type: 'integer', minimum: 1, maximum: 365 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    let resolved;
    try {
      resolved = await resolveAuth(fastify.pg, request.headers.authorization);
    } catch (err) {
      return reply.status(err.statusCode || 401).send({
        error: { message: err.message, statusCode: err.statusCode || 401 },
      });
    }

    const { label, expires_in_days } = request.body || {};

    let expiresAt = null;
    if (expires_in_days) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    const plainKey = generateApiKey();
    const hash = hashApiKey(plainKey);

    const credential = await createCredential(fastify.pg, {
      userId: resolved.user.id,
      credentialType: 'api_key',
      credentialHash: hash,
      label: label || null,
      expiresAt,
    });

    return reply.status(201).send({
      id: credential.id,
      key: plainKey,   // Only time the plaintext key is returned
      label: credential.label,
      expires_at: credential.expires_at,
      created_at: credential.created_at,
    });
  });

  // DELETE /auth/api-keys/:id — revoke an API key
  fastify.delete('/auth/api-keys/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    let resolved;
    try {
      resolved = await resolveAuth(fastify.pg, request.headers.authorization);
    } catch (err) {
      return reply.status(err.statusCode || 401).send({
        error: { message: err.message, statusCode: err.statusCode || 401 },
      });
    }

    const { id } = request.params;

    // Verify ownership before deactivating
    const credentials = await findCredentialsByUserId(fastify.pg, resolved.user.id, 'api_key');
    const owned = credentials.find(c => c.id === id);

    if (!owned) {
      return reply.status(404).send({
        error: { message: 'API key not found', statusCode: 404 },
      });
    }

    await deactivateCredential(fastify.pg, id);
    return reply.status(204).send();
  });
}

module.exports = authRoutes;

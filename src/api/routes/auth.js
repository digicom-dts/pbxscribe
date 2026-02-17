// Auth routes
const { createUser, findUserByEmail } = require('../repositories/userRepository');
const {
  createCredential,
  findCredentialsByUserId,
  deactivateCredential,
  updateLastUsed,
} = require('../repositories/credentialRepository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateApiKey, hashApiKey } = require('../utils/apiKey');
const { generateToken } = require('../utils/jwt');

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

    updateLastUsed(fastify.pg, matchedCredential.id).catch(() => {});

    const token = generateToken({ sub: user.id, email: user.email, name: user.name });
    return { token, user };
  });

  // GET /auth/me — protected
  fastify.get('/auth/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    return request.user;
  });

  // POST /auth/api-keys — protected
  fastify.post('/auth/api-keys', {
    preHandler: [fastify.authenticate],
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
    const { label, expires_in_days } = request.body || {};

    let expiresAt = null;
    if (expires_in_days) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    const plainKey = generateApiKey();
    const hash = hashApiKey(plainKey);

    const credential = await createCredential(fastify.pg, {
      userId: request.user.id,
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

  // DELETE /auth/api-keys/:id — protected
  fastify.delete('/auth/api-keys/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    // Verify ownership before deactivating
    const credentials = await findCredentialsByUserId(fastify.pg, request.user.id, 'api_key');
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

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
      tags: ['Auth'],
      summary: 'Register a new user',
      description: 'Creates a new user account. If a password is supplied, a JWT token is returned immediately.',
      body: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          password: { type: 'string', minLength: 8, description: 'Optional. If omitted the account has no password credential.' },
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                name: { type: 'string' },
                status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
            token: { type: 'string', description: 'JWT token — only present when a password was supplied' },
          },
        },
        409: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                statusCode: { type: 'integer' },
              },
            },
          },
        },
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
      tags: ['Auth'],
      summary: 'Login with email and password',
      description: 'Authenticates a user and returns a signed JWT token.',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'JWT bearer token' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                name: { type: 'string' },
                status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                statusCode: { type: 'integer' },
              },
            },
          },
        },
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
    schema: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Returns the authenticated user profile decoded from the JWT or API key.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    return request.user;
  });

  // POST /auth/api-keys — protected
  fastify.post('/auth/api-keys', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Create an API key',
      description: 'Generates a new API key for the authenticated user. The plaintext key is only returned once.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 100 },
          expires_in_days: { type: 'integer', minimum: 1, maximum: 365 },
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            key: { type: 'string', description: 'Plaintext API key — shown only once, store securely' },
            label: { type: 'string', nullable: true },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
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
      tags: ['Auth'],
      summary: 'Revoke an API key',
      description: 'Deactivates an API key owned by the authenticated user.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        204: { type: 'null', description: 'Key successfully revoked' },
        404: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                statusCode: { type: 'integer' },
              },
            },
          },
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

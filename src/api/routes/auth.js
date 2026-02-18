// Auth routes
const { createUser, findUserByEmail } = require('../repositories/userRepository');
const {
  createCredential,
  findCredentialsByUserId,
  updateLastUsed,
} = require('../repositories/credentialRepository');
const { hashPassword, verifyPassword, checkPasswordStrength } = require('../utils/password');
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
        required: ['email', 'name', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          password: { type: 'string', minLength: 8 },
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
                id: { type: 'integer' },
                email: { type: 'string', format: 'email' },
                name: { type: 'string' },
                status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
                created_at: { type: 'string', format: 'date-time' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
            token: { type: 'string', description: 'JWT token' },
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
        422: {
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

    const { valid, failures } = checkPasswordStrength(password);
    if (!valid) {
      return reply.status(422).send({
        error: { message: `Password too weak: ${failures.join(', ')}`, statusCode: 422 },
      });
    }

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

    const hash = await hashPassword(password);
    await createCredential(fastify.pg, {
      userId: user.id,
      credentialType: 'password',
      credentialHash: hash,
      label: 'password',
    });

    const token = generateToken({ sub: user.id, email: user.email, name: user.name });
    return reply.status(201).send({ user, token });
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
                id: { type: 'integer' },
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
            id: { type: 'integer' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    return request.user;
  });

}

module.exports = authRoutes;

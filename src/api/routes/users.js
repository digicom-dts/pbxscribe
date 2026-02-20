// User CRUD routes
const {
  createUser,
  findUserById,
  updateUser,
  listUsers,
  deleteUser,
} = require('../repositories/userRepository');

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

/**
 * Register user CRUD routes
 * @param {FastifyInstance} fastify - Fastify instance
 */
async function userRoutes(fastify) {
  // POST /users — create user
  fastify.post('/users', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Create a user',
      description: 'Creates a new user record. Requires authentication.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      body: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
        },
        additionalProperties: false,
      },
      response: {
        201: userSchema,
      },
    },
  }, async (request, reply) => {
    const { email, name } = request.body;

    try {
      const user = await createUser(fastify.pg, { email, name });
      return reply.status(201).send(user);
    } catch (error) {
      if (error.code === '23505') {
        return reply.status(409).send({
          error: {
            message: 'A user with this email already exists',
            statusCode: 409,
          },
        });
      }
      throw error;
    }
  });

  // GET /users — list users
  fastify.get('/users', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'List users',
      description: 'Returns a paginated list of users, optionally filtered by status.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            users: { type: 'array', items: userSchema },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { limit, offset, status } = request.query;
    const { users, total } = await listUsers(fastify.pg, { limit, offset, status });

    return { users, total, limit, offset };
  });

  // GET /users/:id — get user by ID
  fastify.get('/users/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get a user',
      description: 'Returns a single user by UUID.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      },
      response: {
        200: userSchema,
      },
    },
  }, async (request, reply) => {
    const user = await findUserById(fastify.pg, request.params.id);

    if (!user) {
      return reply.status(404).send({
        error: {
          message: 'User not found',
          statusCode: 404,
        },
      });
    }

    return user;
  });

  // PUT /users/:id — update user
  fastify.put('/users/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update a user',
      description: 'Updates name and/or status of an existing user.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
        },
        additionalProperties: false,
        minProperties: 1,
      },
      response: {
        200: userSchema,
      },
    },
  }, async (request, reply) => {
    const user = await updateUser(fastify.pg, request.params.id, request.body);

    if (!user) {
      return reply.status(404).send({
        error: {
          message: 'User not found',
          statusCode: 404,
        },
      });
    }

    return user;
  });

  // DELETE /users/:id — delete user
  fastify.delete('/users/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Delete a user',
      description: 'Permanently deletes a user record by UUID.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      },
      response: {
        204: { type: 'null' },
      },
    },
  }, async (request, reply) => {
    const deleted = await deleteUser(fastify.pg, request.params.id);

    if (!deleted) {
      return reply.status(404).send({
        error: {
          message: 'User not found',
          statusCode: 404,
        },
      });
    }

    return reply.status(204).send();
  });
}

module.exports = userRoutes;

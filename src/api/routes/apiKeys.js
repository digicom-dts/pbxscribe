// API key routes
const {
  createCredential,
  findCredentialsByUserId,
  deactivateCredential,
} = require('../repositories/credentialRepository');
const { generateApiKey, hashApiKey } = require('../utils/apiKey');

/**
 * Register API key routes
 * @param {FastifyInstance} fastify
 */
async function apiKeyRoutes(fastify) {
  // GET /api-keys — protected
  fastify.get('/api-keys', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['API Keys'],
      summary: 'List API keys',
      description: 'Returns all API keys belonging to the authenticated user.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            api_keys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  label: { type: 'string', nullable: true },
                  is_active: { type: 'boolean' },
                  last_used_at: { type: 'string', format: 'date-time', nullable: true },
                  expires_at: { type: 'string', format: 'date-time', nullable: true },
                  created_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const credentials = await findCredentialsByUserId(fastify.pg, request.user.id, 'api_key');
    return { api_keys: credentials };
  });

  // POST /api-keys — protected
  fastify.post('/api-keys', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['API Keys'],
      summary: 'Create an API key',
      description: 'Generates a new API key for the authenticated user. The plaintext key is only returned once.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 100 },
          expires_in_days: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
        },
        additionalProperties: false,
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            key: { type: 'string', description: 'Plaintext API key — shown only once, store securely' },
            label: { type: 'string', nullable: true },
            expires_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { label, expires_in_days = 90 } = request.body || {};

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

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

  // DELETE /api-keys/:id — protected
  fastify.delete('/api-keys/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['API Keys'],
      summary: 'Revoke an API key',
      description: 'Deactivates an API key owned by the authenticated user.',
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
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
    const owned = credentials.find(c => String(c.id) === String(id));

    if (!owned) {
      return reply.status(404).send({
        error: { message: 'API key not found', statusCode: 404 },
      });
    }

    await deactivateCredential(fastify.pg, id);
    return reply.status(204).send();
  });
}

module.exports = apiKeyRoutes;

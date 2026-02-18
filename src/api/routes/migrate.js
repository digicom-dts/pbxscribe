// Database migration routes
const { runMigrations } = require('../db/migrator');

/**
 * Register migration routes
 * @param {FastifyInstance} fastify - Fastify instance
 */
async function migrateRoutes(fastify) {
  /**
   * POST /migrate
   * Run pending database migrations
   * Protected by x-migration-secret header
   */
  fastify.post('/migrate', {
    schema: {
      tags: ['Migrations'],
      summary: 'Run database migrations',
      description: 'Applies all pending SQL migrations. Protected by the `x-migration-secret` header.',
      headers: {
        type: 'object',
        properties: {
          'x-migration-secret': { type: 'string' }
        },
        required: ['x-migration-secret']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            applied: {
              type: 'array',
              items: { type: 'string' }
            },
            message: { type: 'string' }
          }
        },
        401: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                statusCode: { type: 'number' }
              }
            }
          }
        },
        500: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                statusCode: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    // Verify migration secret
    const providedSecret = request.headers['x-migration-secret'];
    const expectedSecret = process.env.MIGRATION_SECRET;

    if (!expectedSecret) {
      request.log.error('MIGRATION_SECRET environment variable is not set');
      return reply.status(500).send({
        error: {
          message: 'Migration secret not configured',
          statusCode: 500
        }
      });
    }

    if (providedSecret !== expectedSecret) {
      request.log.warn('Invalid migration secret provided');
      return reply.status(401).send({
        error: {
          message: 'Unauthorized',
          statusCode: 401
        }
      });
    }

    try {
      request.log.info('Running database migrations');
      const result = await runMigrations();
      request.log.info(`Migrations complete: ${result.message}`);

      return result;
    } catch (error) {
      request.log.error('Migration failed:', error);
      return reply.status(500).send({
        error: {
          message: error.message || 'Migration failed',
          statusCode: 500
        }
      });
    }
  });
}

module.exports = migrateRoutes;

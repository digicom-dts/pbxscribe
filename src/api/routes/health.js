// Health check routes
const { getDatabaseConfig } = require('../config/database');

/**
 * Register health check routes
 * @param {FastifyInstance} fastify - Fastify instance
 */
async function healthRoutes(fastify) {
  // Basic health check
  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Service health check',
      description: 'Returns basic service status and uptime.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            environment: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    return {
      status: 'ok',
      service: 'pbxscribe-api',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Database health check
  fastify.get('/health/db', {
    schema: {
      tags: ['Health'],
      summary: 'Database health check',
      description: 'Verifies database connectivity and returns connection details.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            database: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            details: {
              type: 'object',
              properties: {
                host: { type: 'string' },
                port: { type: 'integer' },
                database: { type: 'string' },
                version: { type: 'string' },
                serverTime: { type: 'string' },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            database: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                code: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await fastify.pg.query(
        'SELECT version(), current_database(), NOW() as current_time'
      );

      const dbConfig = await getDatabaseConfig();

      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
        details: {
          host: dbConfig.host,
          port: dbConfig.port,
          database: result.rows[0].current_database,
          version: result.rows[0].version,
          serverTime: result.rows[0].current_time,
        },
      };
    } catch (error) {
      request.log.error('Database health check failed:', error);

      reply.status(503).send({
        status: 'error',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
        error: {
          message: error.message,
          code: error.code,
        },
      });
    }
  });

  // Readiness check
  fastify.get('/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe',
      description: 'Checks if the service is ready to accept traffic (requires DB connectivity).',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      await fastify.pg.query('SELECT 1');
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      reply.status(503).send({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });

  // Liveness check (simple ping)
  fastify.get('/live', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe',
      description: 'Simple ping to confirm the process is alive.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  });
}

module.exports = healthRoutes;

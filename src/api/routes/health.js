// Health check routes
const { getDatabaseConfig } = require('../config/database');

/**
 * Register health check routes
 * @param {FastifyInstance} fastify - Fastify instance
 */
async function healthRoutes(fastify) {
  // Basic health check
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'pbxscribe-api',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Database health check
  fastify.get('/health/db', async (request, reply) => {
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
  fastify.get('/ready', async (request, reply) => {
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
  fastify.get('/live', async (request, reply) => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  });
}

module.exports = healthRoutes;

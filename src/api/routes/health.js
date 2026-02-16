// Health check routes
const { Client } = require('pg');
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
  // TODO: Add authentication/authorization middleware to protect this endpoint
  // This endpoint exposes database connection details and should be restricted
  fastify.get('/health/db', async (request, reply) => {
    const client = new Client();

    try {
      // Get database configuration
      const dbConfig = await getDatabaseConfig();

      // Create client with config
      const client = new Client(dbConfig);

      // Connect to database
      await client.connect();

      // Run a simple query to verify connection
      const result = await client.query('SELECT version(), current_database(), NOW() as current_time');

      // Close connection
      await client.end();

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
      // Make sure to close connection on error
      try {
        await client.end();
      } catch (endError) {
        // Ignore errors when closing
      }

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

  // Readiness check (for Kubernetes/container orchestration)
  fastify.get('/ready', async (request, reply) => {
    try {
      // Get database configuration
      const dbConfig = await getDatabaseConfig();

      // Create client with config
      const client = new Client(dbConfig);

      // Quick connection test
      await client.connect();
      await client.query('SELECT 1');
      await client.end();

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

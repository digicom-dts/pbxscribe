// Fastify application initialization
const fastify = require('fastify');
const databasePlugin = require('./plugins/database');
const healthRoutes = require('./routes/health');
const migrateRoutes = require('./routes/migrate');

/**
 * Initialize and configure Fastify application
 * @returns {Promise<FastifyInstance>} Configured Fastify app
 */
async function init() {
  // Create Fastify instance
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            headers: req.headers,
            hostname: req.hostname,
            remoteAddress: req.ip,
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    trustProxy: true,
  });

  // Determine base path from environment (API Gateway stage)
  // Environments: dev, staging, prod
  // API Gateway stage URL format: /{environment}
  const basePath = process.env.NODE_ENV ? `/${process.env.NODE_ENV}` : '';

  // Register database pool plugin (available across all scopes via fastify-plugin)
  await app.register(databasePlugin);

  // Register plugins and routes with environment prefix
  await app.register(async function (fastify) {
    await fastify.register(healthRoutes);
    await fastify.register(migrateRoutes);

    // Root route
    fastify.get('/', async (request, reply) => {
      return {
        service: 'PBXScribe API',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      };
    });
  }, { prefix: basePath });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const statusCode = error.statusCode || 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message;

    reply.status(statusCode).send({
      error: {
        message,
        statusCode,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Not found handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        message: 'Route not found',
        statusCode: 404,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}

module.exports = init;

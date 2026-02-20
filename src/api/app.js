// Fastify application initialization
const fastify = require('fastify');
const databasePlugin = require('./plugins/database');
const authPlugin = require('./plugins/auth');
const swaggerPlugin = require('./plugins/swagger');
const healthRoutes = require('./routes/health');
const migrateRoutes = require('./routes/migrate');
const userRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const apiKeyRoutes = require('./routes/apiKeys');

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

    // Register shared plugins (break encapsulation via fastify-plugin so decorators
    // are available in all route scopes)
    await app.register(databasePlugin);
    await app.register(authPlugin);

    // OpenAPI v3 docs
    await app.register(swaggerPlugin);

    // Register plugins and routes with environment prefix
    await app.register(async function (fastify) {
        await fastify.register(healthRoutes);
        await fastify.register(migrateRoutes);
        await fastify.register(userRoutes);
        await fastify.register(authRoutes);
        await fastify.register(apiKeyRoutes);

        // TODO: Remove this route once CI/CD is confirmed working
        fastify.get('/deploy-check', async (request, reply) => {
            return {
                status: 'ok',
                message: 'CI/CD deployment verified — remove this route when done',
                environment: process.env.NODE_ENV || 'development',
                lambdaFunction: process.env.AWS_LAMBDA_FUNCTION_NAME || 'local',
                lambdaVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION || 'local',
                deployedAt: new Date().toISOString(),
            };
        });

        // Root route
        fastify.get('/', {
            schema: {
                tags: ['Health'],
                summary: 'Service info',
                description: 'Returns service name, version, and environment.',
                response: {
                    200: {
                        type: 'object',
                        properties: {
                            service: {type: 'string'},
                            version: {type: 'string'},
                            environment: {type: 'string'},
                            docs: {type: 'string'},
                            timestamp: {type: 'string', format: 'date-time'},
                        },
                    },
                },
            },
        }, async (request, reply) => {
            return {
                service: 'PBXScribe API',
                version: '1.1.0',
                environment: process.env.NODE_ENV || 'development',
                docs: `/docs`,
                timestamp: new Date().toISOString(),
            };
        });
    }, {prefix: basePath});

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

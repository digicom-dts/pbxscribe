const fp = require('fastify-plugin');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');

async function swaggerPlugin(fastify) {
  const basePath = process.env.NODE_ENV ? `/${process.env.NODE_ENV}` : '';

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'PBXScribe API',
        description: 'User management and authentication API for PBXScribe, deployed on AWS Lambda.',
        version: '1.0.0',
      },
      servers: [
        { url: process.env.API_BASE_URL || '/' },
      ],
      tags: [
        { name: 'Health', description: 'Service and database health checks' },
        { name: 'Auth', description: 'Authentication and login' },
        { name: 'API Keys', description: 'API key management' },
        { name: 'Users', description: 'User CRUD operations' },
        { name: 'Migrations', description: 'Database migration management' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token obtained from POST /auth/login',
          },
          apiKeyAuth: {
            type: 'http',
            scheme: 'ApiKey',
            description: 'API key obtained from POST /api-keys. Enter the plaintext key — the `ApiKey` prefix is added automatically.',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: `${basePath}/docs`,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

module.exports = fp(swaggerPlugin, { name: 'swagger' });

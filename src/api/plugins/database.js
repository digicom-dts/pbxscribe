// Fastify database pool plugin
const fp = require('fastify-plugin');
const { Pool } = require('pg');
const { getDatabaseConfig } = require('../config/database');

/**
 * Registers a shared pg.Pool on fastify.pg
 * Using fastify-plugin to break encapsulation so the decorator
 * is available across all route scopes.
 */
async function databasePlugin(fastify) {
  const dbConfig = await getDatabaseConfig();
  const pool = new Pool(dbConfig);

  // Verify connectivity on startup
  const client = await pool.connect();
  client.release();
  fastify.log.info('Database pool connected');

  // Decorate the fastify instance with the pool
  fastify.decorate('pg', pool);

  // Close the pool gracefully when Fastify shuts down
  fastify.addHook('onClose', async () => {
    await pool.end();
    fastify.log.info('Database pool closed');
  });
}

module.exports = fp(databasePlugin, {
  name: 'database'
});

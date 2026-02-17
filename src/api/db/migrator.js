// Database migration runner
const { Client } = require('pg');
const { getDatabaseConfig } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Ensure schema_migrations table exists
 * @param {Client} client - PostgreSQL client
 */
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get list of applied migrations
 * @param {Client} client - PostgreSQL client
 * @returns {Promise<string[]>} Array of applied migration filenames
 */
async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  );
  return result.rows.map(row => row.filename);
}

/**
 * Get list of pending migrations from filesystem
 * @param {string[]} appliedMigrations - Already applied migrations
 * @returns {string[]} Array of pending migration filenames
 */
function getPendingMigrations(appliedMigrations) {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

  // Create migrations directory if it doesn't exist
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    return [];
  }

  // Read all .sql files from migrations directory
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Filter out already applied migrations
  return files.filter(file => !appliedMigrations.includes(file));
}

/**
 * Run a single migration file
 * @param {Client} client - PostgreSQL client
 * @param {string} filename - Migration filename
 */
async function runMigration(client, filename) {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  const filePath = path.join(migrationsDir, filename);

  // Read migration SQL
  const sql = fs.readFileSync(filePath, 'utf8');

  // Run migration in a transaction
  await client.query('BEGIN');

  try {
    // Execute migration SQL
    await client.query(sql);

    // Record migration as applied
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );

    await client.query('COMMIT');
    console.log(`✓ Applied migration: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`✗ Failed to apply migration: ${filename}`);
    throw error;
  }
}

/**
 * Run all pending migrations
 * @returns {Promise<{applied: string[], message: string}>} Migration result
 */
async function runMigrations() {
  const dbConfig = await getDatabaseConfig();
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database for migrations');

    // Ensure migrations table exists
    await ensureMigrationsTable(client);

    // Get applied and pending migrations
    const appliedMigrations = await getAppliedMigrations(client);
    const pendingMigrations = getPendingMigrations(appliedMigrations);

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return {
        applied: [],
        message: 'No pending migrations'
      };
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s)`);

    // Run each pending migration
    for (const migration of pendingMigrations) {
      await runMigration(client, migration);
    }

    return {
      applied: pendingMigrations,
      message: `Successfully applied ${pendingMigrations.length} migration(s)`
    };
  } finally {
    await client.end();
  }
}

module.exports = {
  runMigrations
};

// Database configuration module
const AWS = require('aws-sdk');

// Initialize Secrets Manager client
const secretsManager = new AWS.SecretsManager({
  region: process.env.AWS_REGION || 'us-east-2',
});

// Cache for database credentials
let cachedCredentials = null;

/**
 * Retrieve database credentials from AWS Secrets Manager
 * @returns {Promise<{username: string, password: string}>} Database credentials
 */
async function getDbCredentials() {
  // Return cached credentials if available
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const secretArn = process.env.DB_SECRET_ARN;

  if (!secretArn) {
    throw new Error('DB_SECRET_ARN environment variable is not set');
  }

  try {
    console.log('Retrieving database credentials from Secrets Manager');

    const response = await secretsManager
      .getSecretValue({ SecretId: secretArn })
      .promise();

    if (!response.SecretString) {
      throw new Error('Secret string is empty');
    }

    // Parse and cache credentials
    cachedCredentials = JSON.parse(response.SecretString);

    console.log('Database credentials retrieved successfully');
    return cachedCredentials;
  } catch (error) {
    console.error('Failed to retrieve database credentials:', error.message);
    throw new Error(`Failed to retrieve database credentials: ${error.message}`);
  }
}

/**
 * Get database configuration
 * @returns {Promise<Object>} Database connection configuration
 */
async function getDatabaseConfig() {
  const credentials = await getDbCredentials();

  const config = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: credentials.username,
    password: credentials.password,
    ssl: {
      rejectUnauthorized: true,
    },
    // Connection pool settings
    max: 10, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection cannot be established
  };

  // Validate required configuration
  if (!config.host) {
    throw new Error('DB_HOST environment variable is not set');
  }
  if (!config.database) {
    throw new Error('DB_NAME environment variable is not set');
  }

  return config;
}

/**
 * Clear cached credentials (useful for testing or credential rotation)
 */
function clearCredentialsCache() {
  cachedCredentials = null;
}

module.exports = {
  getDatabaseConfig,
  getDbCredentials,
  clearCredentialsCache,
};

// Credential repository - database operations for user_credentials table

/**
 * Create a new credential
 * @param {Pool} pool
 * @param {{ userId: string, credentialType: string, credentialHash: string, label?: string, expiresAt?: Date }} fields
 * @returns {Promise<Object>} Created credential row
 */
async function createCredential(pool, { userId, credentialType, credentialHash, label, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO user_credentials
       (user_id, credential_type, credential_hash, label, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, credential_type, label, is_active, last_used_at, expires_at, created_at`,
    [userId, credentialType, credentialHash, label || null, expiresAt || null]
  );
  return result.rows[0];
}

/**
 * Find all credentials for a user, optionally filtered by type
 * @param {Pool} pool
 * @param {string} userId
 * @param {string} [credentialType] - 'password' | 'api_key'
 * @returns {Promise<Object[]>}
 */
async function findCredentialsByUserId(pool, userId, credentialType) {
  const conditions = ['user_id = $1'];
  const values = [userId];

  if (credentialType) {
    values.push(credentialType);
    conditions.push(`credential_type = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT id, user_id, credential_type, label, is_active, last_used_at, expires_at, created_at
     FROM user_credentials
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    values
  );
  return result.rows;
}

/**
 * Find an active credential by its hash — used during authentication.
 * Joins with users table to return the associated user in one query.
 * @param {Pool} pool
 * @param {string} hash - Hashed credential value
 * @param {string} credentialType - 'password' | 'api_key'
 * @returns {Promise<{ credential: Object, user: Object } | null>}
 */
async function findActiveCredentialByHash(pool, hash, credentialType) {
  const result = await pool.query(
    `SELECT
       uc.id            AS credential_id,
       uc.user_id,
       uc.credential_type,
       uc.label,
       uc.is_active,
       uc.expires_at,
       uc.last_used_at,
       u.id             AS user_id,
       u.email,
       u.name,
       u.status
     FROM user_credentials uc
     JOIN users u ON u.id = uc.user_id
     WHERE uc.credential_hash = $1
       AND uc.credential_type = $2
       AND uc.is_active = true
       AND u.status = 'active'
       AND (uc.expires_at IS NULL OR uc.expires_at > NOW())`,
    [hash, credentialType]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    credential: {
      id: row.credential_id,
      user_id: row.user_id,
      credential_type: row.credential_type,
      label: row.label,
      is_active: row.is_active,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      status: row.status,
    },
  };
}

/**
 * Deactivate a credential by ID
 * @param {Pool} pool
 * @param {string} credentialId - UUID
 * @returns {Promise<boolean>} true if deactivated, false if not found
 */
async function deactivateCredential(pool, credentialId) {
  const result = await pool.query(
    `UPDATE user_credentials
     SET is_active = false, updated_at = NOW()
     WHERE id = $1`,
    [credentialId]
  );
  return result.rowCount > 0;
}

/**
 * Update last_used_at timestamp for a credential (fire-and-forget safe)
 * @param {Pool} pool
 * @param {string} credentialId - UUID
 * @returns {Promise<void>}
 */
async function updateLastUsed(pool, credentialId) {
  await pool.query(
    `UPDATE user_credentials
     SET last_used_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [credentialId]
  );
}

module.exports = {
  createCredential,
  findCredentialsByUserId,
  findActiveCredentialByHash,
  deactivateCredential,
  updateLastUsed,
};

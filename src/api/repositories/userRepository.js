// User repository - database operations for users table

/**
 * Create a new user
 * @param {Pool} pool - pg.Pool instance
 * @param {{ email: string, name: string }} fields
 * @returns {Promise<Object>} Created user row
 */
async function createUser(pool, { email, name }) {
  const result = await pool.query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     RETURNING id, email, name, status, created_at, updated_at`,
    [email, name]
  );
  return result.rows[0];
}

/**
 * Find a user by ID
 * @param {Pool} pool
 * @param {string} id - UUID
 * @returns {Promise<Object|null>}
 */
async function findUserById(pool, id) {
  const result = await pool.query(
    `SELECT id, email, name, status, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Find a user by email
 * @param {Pool} pool
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
async function findUserByEmail(pool, email) {
  const result = await pool.query(
    `SELECT id, email, name, status, created_at, updated_at
     FROM users
     WHERE email = $1`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Update a user (partial updates supported)
 * @param {Pool} pool
 * @param {string} id - UUID
 * @param {{ name?: string, status?: string }} fields - Fields to update
 * @returns {Promise<Object|null>} Updated user row, or null if not found
 */
async function updateUser(pool, id, fields) {
  const allowed = ['name', 'status'];
  const updates = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      updates.push(`${key} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return findUserById(pool, id);
  }

  // Always update updated_at
  updates.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, email, name, status, created_at, updated_at`,
    values
  );
  return result.rows[0] || null;
}

/**
 * List users with pagination and optional status filter
 * @param {Pool} pool
 * @param {{ limit?: number, offset?: number, status?: string }} options
 * @returns {Promise<{ users: Object[], total: number }>}
 */
async function listUsers(pool, { limit = 20, offset = 0, status } = {}) {
  const conditions = [];
  const values = [];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Run data query and count query in parallel
  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, email, name, status, created_at, updated_at
       FROM users
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM users ${where}`,
      values
    )
  ]);

  return {
    users: dataResult.rows,
    total: countResult.rows[0].total
  };
}

/**
 * Delete a user by ID
 * @param {Pool} pool
 * @param {string} id - UUID
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
async function deleteUser(pool, id) {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1',
    [id]
  );
  return result.rowCount > 0;
}

module.exports = {
  createUser,
  findUserById,
  findUserByEmail,
  updateUser,
  listUsers,
  deleteUser,
};

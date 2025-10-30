const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function saveSubscription(userId, groupName, mention = false, dm = false) {
  await pool.query(
    `INSERT INTO subscriptions (user_id, group_name, mention, dm)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET group_name = $2, mention = $3, dm = $4`,
    [userId, groupName, mention, dm]
  );
}

async function getSubscription(userId) {
  const res = await pool.query(
    'SELECT group_name, mention, dm FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  return res.rows[0] || null;
}

async function updatePreferences(userId, mention, dm) {
  await pool.query(
    'UPDATE subscriptions SET mention = $2, dm = $3 WHERE user_id = $1',
    [userId, mention, dm]
  );
}

module.exports = {
  saveSubscription,
  getSubscription,
  updatePreferences,
  pool
};
import pg from 'pg';
import { config } from './config.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Run fn inside a transaction; fn receives a client with the same query API
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(actorId, action, entity, entityId, data) {
  await pool.query(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
    [actorId || null, action, entity || null, entityId == null ? null : String(entityId), data ? JSON.stringify(data) : null]
  );
}

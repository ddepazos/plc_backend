import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

export async function createPostgresStore({ databaseUrl, seedFile }) {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const count = await client.query('SELECT COUNT(*)::int AS n FROM users');
    if (count.rows[0].n === 0) await seedDatabase(client, seedFile);
  } finally { client.release(); }

  let state = await loadState(pool);
  let queue = Promise.resolve();

  return {
    read: () => structuredClone(state),
    update(operation) {
      const job = queue.then(async () => {
        const next = structuredClone(state);
        const result = operation(next);
        await persistState(pool, next);
        state = next;
        return result;
      });
      queue = job.catch(() => {});
      return job;
    },
    close: () => pool.end()
  };
}

async function seedDatabase(client, seedFile) {
  const seed = JSON.parse(await readFile(seedFile, 'utf8'));
  const user = seed.users[0];
  await client.query('BEGIN');
  try {
    const u = await client.query(
      `INSERT INTO users(name,email,status) VALUES($1,$2,'active') RETURNING id`,
      [user.name, user.email]
    );
    const w = await client.query(
      `INSERT INTO wallets(user_id,address,currency,balance_cents) VALUES($1,$2,$3,$4) RETURNING id`,
      [u.rows[0].id, user.walletAddress, user.currency || 'PLC', Math.round(user.balance * 100)]
    );
    for (const tx of seed.transactions) {
      await client.query(
        `INSERT INTO transactions(id,wallet_id,type,amount_cents,status,reference,recipient,method,note,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tx.id, w.rows[0].id, tx.type, Math.round(tx.amount * 100), tx.status || 'completed', tx.reference, tx.recipient || null, tx.method || null, tx.note || null, tx.date]
      );
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function loadState(pool) {
  const userResult = await pool.query(
    `SELECT u.id,u.name,u.email,w.id AS wallet_id,w.address,w.currency,w.balance_cents
     FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.id LIMIT 1`
  );
  if (!userResult.rows.length) throw new Error('PostgreSQL no contiene usuario/billetera PLC.');
  const row = userResult.rows[0];
  const txResult = await pool.query(
    `SELECT id,type,amount_cents,status,reference,recipient,method,note,created_at
     FROM transactions WHERE wallet_id=$1 ORDER BY created_at DESC`, [row.wallet_id]
  );
  const requestResult = await pool.query(
    `SELECT request_key,request_signature,transaction_id FROM idempotency_requests`
  );
  return {
    version: 1,
    user: { id: String(row.id), name: row.name, email: row.email, walletAddress: row.address, currency: row.currency, balanceCents: Number(row.balance_cents) },
    transactions: txResult.rows.map(tx => ({ id: tx.id, userId: String(row.id), type: tx.type, amountCents: Number(tx.amount_cents), status: tx.status, reference: tx.reference, recipient: tx.recipient || undefined, method: tx.method || undefined, note: tx.note || undefined, date: new Date(tx.created_at).toISOString(), demo: true })),
    requests: Object.fromEntries(requestResult.rows.map(r => [r.request_key, { signature: r.request_signature, id: r.transaction_id }]))
  };
}

async function persistState(pool, state) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wallet = await client.query('SELECT id FROM wallets WHERE user_id=$1 FOR UPDATE', [state.user.id]);
    if (!wallet.rows.length) throw new Error('Billetera PostgreSQL no encontrada.');
    const walletId = wallet.rows[0].id;
    await client.query('UPDATE wallets SET balance_cents=$1,updated_at=NOW() WHERE id=$2', [state.user.balanceCents, walletId]);
    for (const tx of state.transactions) {
      await client.query(
        `INSERT INTO transactions(id,wallet_id,type,amount_cents,status,reference,recipient,method,note,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING`,
        [tx.id, walletId, tx.type, tx.amountCents, tx.status, tx.reference, tx.recipient || null, tx.method || null, tx.note || null, tx.date]
      );
    }
    for (const [key, request] of Object.entries(state.requests)) {
      await client.query(
        `INSERT INTO idempotency_requests(request_key,operation,request_signature,transaction_id)
         VALUES($1,'wallet-operation',$2,$3) ON CONFLICT(request_key) DO NOTHING`,
        [key, request.signature, request.id]
      );
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

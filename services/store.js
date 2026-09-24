import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

// Una sola cola por proceso: escribir archivo temporal + rename antes de publicar en memoria.
export async function createStore({ storeFile, seedFile }) {
  let state;
  try { state = JSON.parse(await readFile(storeFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error; // Nunca borrar silenciosamente un archivo dañado.
    const seed = JSON.parse(await readFile(seedFile, 'utf8'));
    const user = seed.users[0];
    state = { version: 1, user: { ...user, balanceCents: Math.round(user.balance * 100) }, transactions: seed.transactions.map(({ amount, ...tx }) => ({ ...tx, amountCents: Math.round(amount * 100), demo: true })), requests: {} };
    delete state.user.balance;
    await persist(state);
  }
  if (state.version !== 1 || !Number.isSafeInteger(state.user?.balanceCents) || state.user.balanceCents < 0 || !Array.isArray(state.transactions) || !state.requests) throw new Error('Persistencia inválida. Conserva el archivo para diagnóstico.');
  async function persist(next) {
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(storeFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(storeFile + '.tmp', storeFile);
  }
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    update(operation) {
      const job = queue.then(async () => {
        const next = structuredClone(state);
        const result = operation(next);
        await persist(next);
        state = next;
        return result;
      });
      queue = job.catch(() => {});
      return job;
    }
  };
}

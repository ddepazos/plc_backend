import { ApiError } from '../models/transaction.js';
import { snapshot, publicTx, transact } from '../services/wallet.js';

export async function api(req, pathname, store, settings) {
  if (req.method === 'GET') {
    if (pathname === '/api/health') return { status: 'ok', mode: 'demo' };
    if (pathname === '/api/state') return snapshot(store.read());
    if (pathname === '/api/wallet') return snapshot(store.read()).users[0];
    if (pathname === '/api/transactions') return store.read().transactions.map(publicTx);
    if (pathname.startsWith('/api/transactions/')) {
      const tx = store.read().transactions.find(t => t.id === pathname.slice('/api/transactions/'.length));
      if (!tx) throw new ApiError(404, 'Transacción no encontrada.');
      return publicTx(tx);
    }
    throw new ApiError(404, 'Ruta no encontrada.');
  }
  const types = { '/api/send': 'sent', '/api/receive': 'received', '/api/topups': 'topup' };
  if (req.method !== 'POST') throw new ApiError(405, 'Método no permitido.');
  if (!types[pathname]) throw new ApiError(404, 'Ruta no encontrada.');
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'Usa application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > settings.maxBodyBytes) throw new ApiError(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'JSON inválido.'); }
  return transact(store, types[pathname], body, req.headers['idempotency-key']);
}

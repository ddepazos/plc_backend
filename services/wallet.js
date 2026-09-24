import { ApiError, makeTransaction } from '../models/transaction.js';

export const publicTx = ({ amountCents, ...tx }) => ({ ...tx, amount: amountCents / 100 });
export function snapshot(state) {
  const { balanceCents, ...user } = state.user;
  return { meta: { mode: 'demo', persistence: 'server', containsRealPersonalData: false }, users: [{ ...user, balance: balanceCents / 100 }], transactions: state.transactions.map(publicTx) };
}
export function transact(store, type, body, key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(key)) throw new ApiError(400, 'Idempotency-Key requerido (16–100 letras, números o guiones).');
  const tx = makeTransaction(type, body, store.read().user.id);
  const signature = JSON.stringify([type, tx.amountCents, tx.recipient || '', tx.method || '', tx.note]);
  return store.update(state => {
    const previous = state.requests[key];
    if (previous) {
      if (previous.signature !== signature) throw new ApiError(409, 'Esta clave ya se usó con otra operación.');
      return { transaction: publicTx(state.transactions.find(t => t.id === previous.id)), replayed: true };
    }
    if (type === 'sent' && tx.recipient === state.user.walletAddress) throw new ApiError(400, 'El destinatario debe ser otra dirección demo.');
    if (type === 'sent' && tx.amountCents > state.user.balanceCents) throw new ApiError(409, 'Saldo insuficiente.');
    const balance = state.user.balanceCents + (type === 'sent' ? -tx.amountCents : tx.amountCents);
    if (!Number.isSafeInteger(balance) || balance > 1000000000) throw new ApiError(409, 'Límite de saldo demo: 10.000.000 PLC.');
    state.user.balanceCents = balance;
    state.transactions.unshift(tx);
    state.requests[key] = { signature, id: tx.id };
    return { transaction: publicTx(tx), replayed: false };
  });
}

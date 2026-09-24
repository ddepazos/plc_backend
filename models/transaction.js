import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function cents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw new ApiError(400, 'Monto inválido: usa hasta dos decimales.');
  }
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || result < 1 || result > 100000000) throw new ApiError(400, 'El monto debe estar entre 0,01 y 1.000.000 PLC.');
  return result;
}
export function makeTransaction(type, body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Objeto JSON requerido.');
  const allowed = new Set(['amount', 'recipient', 'note', 'method']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new ApiError(400, 'Campo desconocido. No envíes datos personales ni credenciales.');
  const amountCents = cents(body.amount);
  if (type === 'sent' && (typeof body.recipient !== 'string' || !/^PLC-DEMO-[A-Z0-9-]{3,60}$/.test(body.recipient))) throw new ApiError(400, 'Usa una dirección ficticia PLC-DEMO-DESTINO.');
  if (type === 'topup' && !['bank', 'ethereum'].includes(body.method)) throw new ApiError(400, 'Método válido: bank o ethereum.');
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 140)) throw new ApiError(400, 'La nota admite hasta 140 caracteres.');
  return {
    id: randomUUID(), userId, type, amountCents, date: new Date().toISOString(),
    status: 'completed', reference: 'PLC-DEMO-' + randomUUID(),
    ...(type === 'sent' ? { recipient: body.recipient } : {}),
    ...(type === 'topup' ? { method: body.method } : {}),
    note: body.note || '', demo: true
  };
}

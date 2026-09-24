import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function config(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválido');
  return {
    host: '127.0.0.1', port,
    databaseUrl: env.DATABASE_URL || null,
    storeFile: env.PLC_DATA_FILE ? path.resolve(env.PLC_DATA_FILE) : path.join(root, 'backend/storage/demo.json'),
    seedFile: path.join(root, 'data/plc-demo.json'),
    maxBodyBytes: 8192
  };
}

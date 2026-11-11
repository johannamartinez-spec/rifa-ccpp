import { createHmac } from 'node:crypto';
export const SECRETO = 'secreto-de-pruebas-e2e-de-al-menos-32-caracteres';
const b64u = (b) => Buffer.from(b).toString('base64url');
export function firmar(payload) {
  const cab = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64u(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  return `${cab}.${cuerpo}.${createHmac('sha256', SECRETO).update(`${cab}.${cuerpo}`).digest('base64url')}`;
}

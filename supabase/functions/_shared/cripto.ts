/** Cifrado AES-256-GCM del refresh token de Google (la clave vive sólo en secretos de la función Edge). */

const b64 = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function clave(claveBase64: string): Promise<CryptoKey> {
  const raw = b64.dec(claveBase64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrar(texto: string, claveBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await clave(claveBase64), new TextEncoder().encode(texto)));
  return `v1.${b64.enc(iv)}.${b64.enc(ct)}`;
}

export async function descifrar(paquete: string, claveBase64: string): Promise<string> {
  const [v, iv, ct] = paquete.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Formato de token cifrado inválido');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(iv) }, await clave(claveBase64), b64.dec(ct));
  return new TextDecoder().decode(pt);
}

export function aleatorioUrl(bytes = 24): string {
  return b64.enc(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Comparación en tiempo constante */
export function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

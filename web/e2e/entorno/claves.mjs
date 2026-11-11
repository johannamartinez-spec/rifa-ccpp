import { firmar } from './pasarela-claves.mjs';
const tipo = process.argv[2];
console.log(firmar({ role: tipo, iss: 'supabase-e2e', exp: Math.floor(Date.now() / 1000) + 86400 * 30 }));

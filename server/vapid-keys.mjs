// Gera o par de chaves VAPID (P-256). Usado pelo workflow de deploy quando o
// Worker ainda não tem as chaves; a privada vai direto para o segredo do
// Worker e não aparece no log.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const pub = Buffer.from(raw).toString('base64url');
const which = process.argv[2];
process.stdout.write(which === 'private' ? JSON.stringify(jwk) : which === 'public' ? pub : JSON.stringify({ jwk, pub }));

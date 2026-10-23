// A página de chave do APK gera um certificado X.509 válido, autoassinado,
// de 50 anos, cuja impressão digital é a que a página mostra, e uma chave
// PKCS#8 que assina e confere com esse certificado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey, sign, verify, createHash } from 'node:crypto';
import { makeAndroidKey } from './chave-android.mjs';

test('chave do APK: certificado X.509 autoassinado, 50 anos, digital certa', async () => {
  for (const now of [new Date('2026-10-23T12:00:00Z'), new Date('2051-01-02T03:04:05Z')]) {
    const k = await makeAndroidKey(now);
    const cert = new X509Certificate(k.cert);
    assert.equal(cert.subject, 'CN=Pacto Talk\nO=Pacto Talk');
    assert.equal(cert.issuer, cert.subject);
    assert.ok(cert.verify(cert.publicKey), 'assinatura do próprio certificado');
    assert.equal(cert.publicKey.asymmetricKeyDetails.modulusLength, 4096);
    assert.equal(new Date(cert.validFrom).getTime(), Math.floor(now.getTime() / 1000) * 1000);
    assert.equal(new Date(cert.validTo).getUTCFullYear(), now.getUTCFullYear() + 50);
    assert.equal(createHash('sha256').update(cert.raw).digest('hex'), k.fp);
    const key = createPrivateKey({ key: Buffer.from(k.key, 'base64'), format: 'der', type: 'pkcs8' });
    const sig = sign('sha256', Buffer.from('apk'), key);
    assert.ok(verify('sha256', Buffer.from('apk'), cert.publicKey, sig));
  }
});

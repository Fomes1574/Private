package com.mensageiro.privado;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Equivalente Android do PRF da passkey (ADR 0005): um segredo aleatório de
// 32 bytes guardado cifrado por uma chave do Android Keystore que só funciona
// depois da biometria. O app usa esse segredo junto com o PIN para derivar a
// chave que desembrulha a chave do banco. A biometria libera uma CHAVE, não
// responde só "sim/não" (V7-019).
@CapacitorPlugin(name = "BiometricSecret")
public class BiometricSecretPlugin extends Plugin {
    private static final String ALIAS = "mp-biometric-secret-v1";
    private static final String PREFS = "mp-secure";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void available(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject out = new JSObject();
        out.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(out);
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        if (!create) return null;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true) // digital nova cadastrada = chave inválida
                .build());
        return kg.generateKey();
    }

    // Cria (na primeira vez) ou devolve o segredo, sempre pedindo biometria.
    @PluginMethod
    public void secret(PluginCall call) {
        try {
            String stored = prefs().getString("ct", null);
            boolean first = stored == null;
            SecretKey k = key(first);
            if (k == null) { call.reject("sem chave"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            if (first) c.init(Cipher.ENCRYPT_MODE, k);
            else c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(prefs().getString("iv", ""), Base64.NO_WRAP)));
            prompt(call, c, first, stored);
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("biometria mudou: chave invalidada", "INVALIDATED");
        } catch (Exception e) {
            call.reject("falha no Keystore");
        }
    }

    private void prompt(PluginCall call, Cipher cipher, boolean first, String stored) {
        getActivity().runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Confirmar")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Cancelar")
                    .build();
            new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    try {
                        Cipher c = result.getCryptoObject().getCipher();
                        byte[] secret;
                        if (first) {
                            secret = new byte[32];
                            new SecureRandom().nextBytes(secret);
                            byte[] ct = c.doFinal(secret);
                            prefs().edit()
                                    .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                                    .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                                    .apply();
                        } else {
                            secret = c.doFinal(Base64.decode(stored, Base64.NO_WRAP));
                        }
                        JSObject out = new JSObject();
                        out.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                        java.util.Arrays.fill(secret, (byte) 0);
                        call.resolve(out);
                    } catch (Exception e) {
                        call.reject("falha ao liberar a chave");
                    }
                }

                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    call.reject("biometria cancelada", "CANCELED");
                }
            }).authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    // Apagar tudo: destrói a chave do Keystore (crypto-shredding).
    @PluginMethod
    public void destroy(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
            prefs().edit().clear().apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("falha ao destruir");
        }
    }
}

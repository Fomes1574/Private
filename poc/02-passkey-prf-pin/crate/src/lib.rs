//! Argon2id para derivar a parte do PIN da chave-envelope (ADR 0005).
//! Só expõe uma função: o resto da cripto é WebCrypto.

use argon2::{Algorithm, Argon2, Params, Version};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

/// Argon2id(secret, salt) com 32 bytes de saída. `m_kib` em KiB.
#[wasm_bindgen]
pub fn argon2id(secret: &mut [u8], salt: &[u8], m_kib: u32, t: u32, p: u32) -> Result<Vec<u8>, JsError> {
    let params = Params::new(m_kib, t, p, Some(32)).map_err(|e| JsError::new(&e.to_string()))?;
    let mut out = vec![0u8; 32];
    let res = Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, &mut out);
    // Apaga a cópia do PIN que veio do JS para a memória do WASM.
    secret.zeroize();
    res.map_err(|e| JsError::new(&e.to_string()))?;
    Ok(out)
}

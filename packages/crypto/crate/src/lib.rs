//! Criptografia do app (ADR 0002, ADR 0005).
//!
//! Olm 1:1 da vodozemac (Double Ratchet par a par, fan-out por destinatário,
//! sem Megolm) e Argon2id para o PIN. Revisado a partir da Prova 1.

use vodozemac::olm::{Account, OlmMessage, Session, SessionConfig};
use vodozemac::Curve25519PublicKey;
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

fn err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

fn pickle_key(bytes: &[u8]) -> Result<[u8; 32], JsError> {
    bytes
        .try_into()
        .map_err(|_| JsError::new("a chave de pickle precisa ter 32 bytes"))
}

fn curve_key(b64: &str) -> Result<Curve25519PublicKey, JsError> {
    Curve25519PublicKey::from_base64(b64).map_err(err)
}

/// Versão da biblioteca compilada, para o relatório.
#[wasm_bindgen(js_name = vodozemacVersion)]
pub fn vodozemac_version() -> String {
    "mp-crypto 0.1.0 / vodozemac 0.11.1 / olm v1".into()
}

#[wasm_bindgen]
pub struct OlmAccount {
    inner: Account,
}

#[wasm_bindgen]
impl OlmAccount {
    #[wasm_bindgen(constructor)]
    pub fn new() -> OlmAccount {
        OlmAccount { inner: Account::new() }
    }

    #[wasm_bindgen(getter, js_name = curve25519Key)]
    pub fn curve25519_key(&self) -> String {
        self.inner.curve25519_key().to_base64()
    }

    #[wasm_bindgen(getter, js_name = ed25519Key)]
    pub fn ed25519_key(&self) -> String {
        self.inner.ed25519_key().to_base64()
    }

    #[wasm_bindgen(js_name = generateOneTimeKeys)]
    pub fn generate_one_time_keys(&mut self, count: usize) {
        self.inner.generate_one_time_keys(count);
    }

    /// Chaves de uso único ainda não publicadas, como JSON `{id: chave}`.
    #[wasm_bindgen(js_name = oneTimeKeys)]
    pub fn one_time_keys(&self) -> String {
        let map: serde_json::Map<String, serde_json::Value> = self
            .inner
            .one_time_keys()
            .into_iter()
            .map(|(id, key)| (id.to_base64(), key.to_base64().into()))
            .collect();
        serde_json::Value::Object(map).to_string()
    }

    /// Gera (ou troca) a chave de reserva, usada quando acabam as de uso único.
    #[wasm_bindgen(js_name = generateFallbackKey)]
    pub fn generate_fallback_key(&mut self) {
        self.inner.generate_fallback_key();
    }

    /// Chave de reserva ainda não publicada, como JSON `{id: chave}`.
    #[wasm_bindgen(js_name = fallbackKey)]
    pub fn fallback_key(&self) -> String {
        let map: serde_json::Map<String, serde_json::Value> = self
            .inner
            .fallback_key()
            .into_iter()
            .map(|(id, key)| (id.to_base64(), key.to_base64().into()))
            .collect();
        serde_json::Value::Object(map).to_string()
    }

    #[wasm_bindgen(js_name = markKeysAsPublished)]
    pub fn mark_keys_as_published(&mut self) {
        self.inner.mark_keys_as_published();
    }

    #[wasm_bindgen(js_name = createOutboundSession)]
    pub fn create_outbound_session(
        &self,
        their_identity_key: &str,
        their_one_time_key: &str,
    ) -> Result<OlmSession, JsError> {
        let session = self
            .inner
            .create_outbound_session(
                SessionConfig::version_1(),
                curve_key(their_identity_key)?,
                curve_key(their_one_time_key)?,
            )
            .map_err(err)?;
        Ok(OlmSession { inner: session })
    }

    /// Cria a sessão de entrada a partir da primeira mensagem (tipo 0, pre-key).
    /// Devolve a sessão; o texto decifrado fica em `takeInboundPlaintext`.
    #[wasm_bindgen(js_name = createInboundSession)]
    pub fn create_inbound_session(
        &mut self,
        their_identity_key: &str,
        message_type: usize,
        body: &[u8],
    ) -> Result<InboundResult, JsError> {
        let message = OlmMessage::from_parts(message_type, body).map_err(err)?;
        let OlmMessage::PreKey(pre_key) = message else {
            return Err(JsError::new("a primeira mensagem precisa ser do tipo pre-key"));
        };
        let result = self
            .inner
            .create_inbound_session(
                SessionConfig::version_1(),
                curve_key(their_identity_key)?,
                &pre_key,
            )
            .map_err(err)?;
        Ok(InboundResult {
            session: Some(OlmSession { inner: result.session }),
            plaintext: result.plaintext,
        })
    }

    /// Estado cifrado (ChaCha20-Poly1305 da própria vodozemac) com chave de 32 bytes.
    pub fn pickle(&self, key: &[u8]) -> Result<String, JsError> {
        let mut k = pickle_key(key)?;
        let out = self.inner.pickle().encrypt(&k);
        k.zeroize();
        Ok(out)
    }

    #[wasm_bindgen(js_name = fromPickle)]
    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<OlmAccount, JsError> {
        let mut k = pickle_key(key)?;
        let p = vodozemac::olm::AccountPickle::from_encrypted(pickle, &k);
        k.zeroize();
        Ok(OlmAccount { inner: Account::from_pickle(p.map_err(err)?) })
    }
}

impl Default for OlmAccount {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct InboundResult {
    session: Option<OlmSession>,
    plaintext: Vec<u8>,
}

#[wasm_bindgen]
impl InboundResult {
    #[wasm_bindgen(js_name = takeSession)]
    pub fn take_session(&mut self) -> Result<OlmSession, JsError> {
        self.session.take().ok_or_else(|| JsError::new("sessão já retirada"))
    }

    #[wasm_bindgen(js_name = takePlaintext)]
    pub fn take_plaintext(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.plaintext)
    }
}

impl Drop for InboundResult {
    fn drop(&mut self) {
        self.plaintext.zeroize();
    }
}

#[wasm_bindgen]
pub struct EncryptedMessage {
    message_type: usize,
    body: Vec<u8>,
}

#[wasm_bindgen]
impl EncryptedMessage {
    /// 0 = pre-key (primeira mensagem), 1 = normal.
    #[wasm_bindgen(getter, js_name = messageType)]
    pub fn message_type(&self) -> usize {
        self.message_type
    }

    #[wasm_bindgen(getter)]
    pub fn body(&self) -> Vec<u8> {
        self.body.clone()
    }
}

#[wasm_bindgen]
pub struct OlmSession {
    inner: Session,
}

#[wasm_bindgen]
impl OlmSession {
    #[wasm_bindgen(getter, js_name = sessionId)]
    pub fn session_id(&self) -> String {
        self.inner.session_id()
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<EncryptedMessage, JsError> {
        let (message_type, body) = self.inner.encrypt(plaintext).map_err(err)?.to_parts();
        Ok(EncryptedMessage { message_type, body })
    }

    pub fn decrypt(&mut self, message_type: usize, body: &[u8]) -> Result<Vec<u8>, JsError> {
        let message = OlmMessage::from_parts(message_type, body).map_err(err)?;
        self.inner.decrypt(&message).map_err(err)
    }

    pub fn pickle(&self, key: &[u8]) -> Result<String, JsError> {
        let mut k = pickle_key(key)?;
        let out = self.inner.pickle().encrypt(&k);
        k.zeroize();
        Ok(out)
    }

    #[wasm_bindgen(js_name = fromPickle)]
    pub fn from_pickle(pickle: &str, key: &[u8]) -> Result<OlmSession, JsError> {
        let mut k = pickle_key(key)?;
        let p = vodozemac::olm::SessionPickle::from_encrypted(pickle, &k);
        k.zeroize();
        Ok(OlmSession { inner: Session::from_pickle(p.map_err(err)?) })
    }
}

/// Argon2id(secret, salt) com 32 bytes de saída; apaga a cópia do segredo.
#[wasm_bindgen]
pub fn argon2id(secret: &mut [u8], salt: &[u8], m_kib: u32, t: u32, p: u32) -> Result<Vec<u8>, JsError> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let params = Params::new(m_kib, t, p, Some(32)).map_err(err)?;
    let mut out = vec![0u8; 32];
    let res = Argon2::new(Algorithm::Argon2id, Version::V0x13, params).hash_password_into(secret, salt, &mut out);
    secret.zeroize();
    res.map_err(err)?;
    Ok(out)
}

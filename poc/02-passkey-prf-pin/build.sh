#!/usr/bin/env bash
# Compila o Argon2id para WASM em web/pkg (mesmas regras de reprodutibilidade da prova 1).
set -euo pipefail
cd "$(dirname "$0")"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$PWD=/src"
(cd crate && cargo build --release --target wasm32-unknown-unknown --locked)
wasm-bindgen --target web --no-typescript --out-dir web/pkg \
  crate/target/wasm32-unknown-unknown/release/kdf_poc.wasm
sha256sum web/pkg/kdf_poc_bg.wasm

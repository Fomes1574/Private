#!/usr/bin/env bash
# Compila mp-crypto para WASM em pkg/ (reproduzível: toolchain fixa, caminhos removidos).
set -euo pipefail
cd "$(dirname "$0")"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$PWD=/src"
(cd crate && cargo build --release --target wasm32-unknown-unknown --locked)
wasm-bindgen --target web --no-typescript --out-dir pkg crate/target/wasm32-unknown-unknown/release/mp_crypto.wasm
sha256sum pkg/mp_crypto_bg.wasm

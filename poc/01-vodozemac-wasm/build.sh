#!/usr/bin/env bash
# Compila o wrapper Rust para WASM e gera os bindings JS em web/pkg.
# Requer: rustup target add wasm32-unknown-unknown
#         cargo install wasm-bindgen-cli --version 0.2.129
set -euo pipefail
cd "$(dirname "$0")"
cargo build --manifest-path crate/Cargo.toml --release --target wasm32-unknown-unknown --locked
wasm-bindgen --target web --no-typescript --out-dir web/pkg \
  crate/target/wasm32-unknown-unknown/release/vz_poc.wasm
sha256sum web/pkg/vz_poc_bg.wasm

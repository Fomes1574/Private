#!/bin/sh
# Mata servidores de teste que ficaram órfãos (teste interrompido à força).
# Só processos node/workerd/esbuild (nunca o shell que chamou o script).
ps -eo pid=,comm=,args= | awk '
  ($2 == "node" || $2 == "workerd" || $2 == "esbuild") &&
  ($0 ~ /wrangler(-dist\/cli\.js)? dev|node --test|workerd serve|esbuild --service|test\/app\.test\.mjs/) { print $1 }
' | while read -r p; do kill -9 "$p" 2>/dev/null; done
exit 0

#!/bin/sh
# Mata servidores de teste que ficaram órfãos (teste interrompido à força).
for p in $(ps -eo pid=,args= | awk '/wrangler(-dist\/cli\.js)? dev|node --test|\/bin\/workerd serve|esbuild --service/ && !/awk/ {print $1}'); do
  [ "$p" = "$$" ] || kill -9 "$p" 2>/dev/null
done
exit 0

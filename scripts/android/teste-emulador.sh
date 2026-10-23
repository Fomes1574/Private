#!/usr/bin/env bash
# Teste nativo no emulador Android (CI), com o APK de RELEASE assinado por
# uma chave descartável. Confere no aparelho o que o Chromium sozinho não
# mostra. Emulador NÃO substitui o teste em celular de verdade
# (docs/TESTE_EM_CELULAR.md): isto só barra regressões.
# Uso: teste-emulador.sh <apk> <pacote>
set -euo pipefail
APK=$1; PKG=$2
ACT="$PKG/com.mensageiro.privado.MainActivity"
fail() { echo "FALHOU: $*" >&2; adb logcat -d -t 300 | grep -iE "pactotalk|mensageiro|AndroidRuntime" | tail -40 >&2 || true; exit 1; }

adb install -r "$APK" >/dev/null
DUMP=$(adb shell dumpsys package "$PKG")

# 1) Sem depuração e sem backup (flags reais do pacote instalado).
FLAGS=$(echo "$DUMP" | grep -m1 ' flags=\[' || true)
echo "flags: $FLAGS"
echo "$FLAGS" | grep -q DEBUGGABLE && fail "pacote depurável"
echo "$FLAGS" | grep -q ALLOW_BACKUP && fail "backup permitido"
adb shell run-as "$PKG" ls 2>&1 | grep -qiE "not debuggable|unknown package|is not an application" || fail "run-as conseguiu entrar nos dados do app"

# 2) Permissões perigosas começam negadas (pedidas só na hora do uso).
for p in CAMERA RECORD_AUDIO POST_NOTIFICATIONS; do
  echo "$DUMP" | grep -E "android.permission.$p: granted=true" && fail "$p já concedida sem pedir"
done
true

# 3) Abre o app e espera a interface.
adb logcat -c
adb shell am start -W -n "$ACT" >/dev/null
for i in $(seq 1 40); do
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml 2>/dev/null | grep -q 'Pacto Talk' && break
  sleep 2
done
UI=$(adb shell cat /sdcard/ui.xml)
echo "$UI" | grep -q 'Pacto Talk' || fail "interface não apareceu"
echo "$UI" | grep -qE 'Tenho um convite|Instalar a primeira pessoa|Primeira instalação' || fail "tela inicial incompleta"
pidof_app=$(adb shell pidof "$PKG" || true)
[ -n "$pidof_app" ] || fail "app fechou sozinho"

# 4) FLAG_SECURE: a janela é segura e o print sai preto.
adb shell dumpsys window windows | grep -A30 "$PKG" | grep -qE 'fl=.*SECURE|FLAG_SECURE' || fail "janela sem FLAG_SECURE"
adb exec-out screencap > /tmp/tela.raw
node -e '
  const b = require("fs").readFileSync("/tmp/tela.raw");
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  const head = b.length - w * h * 4; // 12 ou 16 bytes de cabeçalho
  let lit = 0, n = 0;
  // Só o meio da tela (fora barra de status e de navegação, que não são do app).
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y += 4)
    for (let x = 0; x < w; x += 4) { const i = head + (y * w + x) * 4; n++; if (b[i] + b[i + 1] + b[i + 2] > 30) lit++; }
  console.log(`print: ${w}x${h}, pixels acesos no meio: ${(100 * lit / n).toFixed(2)}%`);
  if (lit / n > 0.01) process.exit(1);
' || fail "print da tela mostrou o conteúdo"

# 5) Sem porta de depuração do WebView aberta.
adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pidof_app" && fail "depuração do WebView ligada"

# 6) Nada do console do app no logcat (release sem console).
adb logcat -d | grep -E "Capacitor/Console|chromium.*CONSOLE" && fail "console do app vazando para o logcat"

# 7) Recentes: ao ir para o fundo, a prévia não mostra o conteúdo (Android 13+).
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell pidof "$PKG" >/dev/null || fail "app morreu ao ir para o fundo"

echo "Emulador: tudo certo para $PKG"

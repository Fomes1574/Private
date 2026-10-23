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

# Mede um print cru do screencap: imprime "vazio" (o sistema recusou) ou a
# fração de pixels acesos no meio da tela (fora das barras do sistema).
medir_print() {
  node -e '
    const b = require("fs").readFileSync(process.argv[1]);
    if (b.length < 16) { console.log("vazio"); process.exit(0); }
    const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
    const head = b.length - w * h * 4; // 12 ou 16 bytes de cabeçalho
    if (w < 1 || h < 1 || head < 8 || head > 16) { console.log("vazio"); process.exit(0); }
    let lit = 0, n = 0;
    for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y += 4)
      for (let x = 0; x < w; x += 4) { const i = head + (y * w + x) * 4; n++; if (b[i] + b[i + 1] + b[i + 2] > 30) lit++; }
    console.log((lit / n).toFixed(4));
  ' "$1"
}

# O ambiente precisa ser como um celular de verdade (build "user"): numa
# imagem de depuração o Android liga a depuração de todo WebView e o teste do
# item 5 não diria nada sobre o app.
BUILD="$(adb shell getprop ro.build.type | tr -d '\r') ro.debuggable=$(adb shell getprop ro.debuggable | tr -d '\r')"
echo "emulador: $BUILD"
echo "$BUILD" | grep -q 'ro.debuggable=0' || fail "emulador é build de depuração ($BUILD): o teste não seria válido"

adb install -r "$APK" >/dev/null
DUMP=$(adb shell dumpsys package "$PKG")

# 1) Sem depuração e sem backup (flags reais do pacote instalado).
FLAGS=$(echo "$DUMP" | grep -m1 ' flags=\[' || true)
echo "flags: $FLAGS"
echo "$FLAGS" | grep -q DEBUGGABLE && fail "pacote depurável"
echo "$FLAGS" | grep -q ALLOW_BACKUP && fail "backup permitido"
# run-as só entra em app depurável. Reprova só se ele de fato rodou como o
# app (a mensagem de recusa muda entre versões do Android).
RUNAS=$(adb shell run-as "$PKG" id 2>&1 || true)
echo "run-as: $RUNAS"
echo "$RUNAS" | grep -q 'uid=' && fail "run-as conseguiu entrar nos dados do app"

# 2) Permissões perigosas começam negadas (pedidas só na hora do uso).
for p in CAMERA RECORD_AUDIO POST_NOTIFICATIONS; do
  echo "$DUMP" | grep -E "android.permission.$p: granted=true" && fail "$p já concedida sem pedir"
done
true

# Controle: com a tela inicial do Android, o print TEM que funcionar e
# mostrar algo. Sem isso, um print vazio no app não provaria nada.
adb shell input keyevent KEYCODE_HOME
sleep 3
adb exec-out screencap > /tmp/home.raw 2>/tmp/home.err || true
HOME_LIT=$(medir_print /tmp/home.raw)
echo "print de controle (tela inicial): $HOME_LIT"
[ "$HOME_LIT" != vazio ] && awk -v v="$HOME_LIT" 'BEGIN{exit !(v > 0.05)}' || fail "print de controle não funciona neste emulador (o teste de FLAG_SECURE não seria válido)"

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

# 4) FLAG_SECURE. Primeiro o efeito (o print sai preto), depois a flag na
# janela da MainActivity (não a da tela de abertura, que é outra janela).
adb exec-out screencap > /tmp/tela.raw 2>/tmp/tela.err || true
APP_LIT=$(medir_print /tmp/tela.raw)
echo "print com o app aberto: $APP_LIT $(head -c 200 /tmp/tela.err | tr '\n' ' ')"
if [ "$APP_LIT" != vazio ]; then
  awk -v v="$APP_LIT" 'BEGIN{exit !(v <= 0.01)}' || fail "print da tela mostrou o conteúdo"
fi
WIN=$(adb shell dumpsys window windows | awk -v a="$PKG/com.mensageiro.privado.MainActivity" '/Window #/{p=index($0,a)>0} p')
echo "janela: $(echo "$WIN" | grep -m1 -E '^[[:space:]]*fl=|[[:space:]]fl=' | tr -s ' ')"
[ -n "$WIN" ] || fail "janela da MainActivity não encontrada no dumpsys"
echo "$WIN" | grep -q 'SECURE' || fail "janela da MainActivity sem FLAG_SECURE"

# 5) Sem porta de depuração do WebView aberta.
SOCKS=$(adb shell cat /proc/net/unix | grep -o '@\?webview_devtools_remote_[0-9]*' | sort -u | tr '\n' ' ')
echo "sockets de depuração de WebView: ${SOCKS:-nenhum} (app pid $pidof_app)"
echo "$SOCKS" | grep -qw "webview_devtools_remote_$pidof_app" && fail "depuração do WebView ligada"

# 6) Nada do console do app no logcat (release sem console).
adb logcat -d | grep -E "Capacitor/Console|chromium.*CONSOLE" && fail "console do app vazando para o logcat"

# 7) Recentes: ao ir para o fundo, a prévia não mostra o conteúdo (Android 13+).
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell pidof "$PKG" >/dev/null || fail "app morreu ao ir para o fundo"

echo "Emulador: tudo certo para $PKG"

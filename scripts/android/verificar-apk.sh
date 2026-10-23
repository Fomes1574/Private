#!/usr/bin/env bash
# Confere um APK de distribuição ANTES de publicar (e o APK de teste no CI):
# assinatura v2/v3 com UM certificado esperado, pacote, número de versão,
# sem depuração, sem backup, sem tráfego em claro e só as permissões da lista.
# Uso: verificar-apk.sh <apk> <sha256-do-certificado> <pacote> [versionCode]
set -euo pipefail
APK=$1; WANT_FP=$(echo "$2" | tr 'A-F' 'a-f' | tr -d ': '); PKG=$3; WANT_VC=${4:-}
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
fail() { echo "APK REPROVADO: $*" >&2; exit 1; }

# 1) Assinatura.
SIG=$("$BT/apksigner" verify --verbose --print-certs "$APK")
echo "$SIG" | grep -Eq 'Verified using v(2|3) scheme.*: true' || fail "sem assinatura v2/v3"
[ "$(echo "$SIG" | grep -c 'certificate SHA-256 digest')" = 1 ] || fail "precisa de exatamente um certificado"
GOT_FP=$(echo "$SIG" | sed -n 's/.*certificate SHA-256 digest: //p' | tr -d ' ')
[ "$GOT_FP" = "$WANT_FP" ] || fail "certificado $GOT_FP não é o esperado $WANT_FP"

# 2) Manifesto compilado.
BADGE=$("$BT/aapt2" dump badging "$APK")
echo "$BADGE" | grep -q "^package: name='$PKG' " || fail "pacote diferente de $PKG"
[ -z "$WANT_VC" ] || echo "$BADGE" | grep -q "versionCode='$WANT_VC'" || fail "versionCode diferente de $WANT_VC"
echo "$BADGE" | grep -q 'application-debuggable' && fail "APK depurável"
XML=$("$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK")
echo "$XML" | grep -Eq 'android:allowBackup.*=false' || fail "backup não está desligado"
echo "$XML" | grep -Eq 'android:usesCleartextTraffic.*=false' || fail "tráfego em claro não está desligado"
echo "$XML" | grep -Eq 'android:debuggable.*=true' && fail "debuggable=true no manifesto"

# 3) Permissões: só estas. Qualquer outra reprova (biblioteca nova não entra calada).
ALLOWED="android.permission.INTERNET
android.permission.USE_BIOMETRIC
android.permission.USE_FINGERPRINT
android.permission.POST_NOTIFICATIONS
android.permission.CAMERA
android.permission.RECORD_AUDIO
android.permission.MODIFY_AUDIO_SETTINGS
android.permission.WAKE_LOCK
android.permission.ACCESS_NETWORK_STATE
com.google.android.c2dm.permission.RECEIVE
$PKG.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
PERMS=$(echo "$BADGE" | sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" | sort -u)
EXTRA=$(comm -23 <(echo "$PERMS") <(echo "$ALLOWED" | sort -u))
[ -z "$EXTRA" ] || fail "permissões fora da lista: $EXTRA"

# 4) Nada que não deveria ir no pacote.
LIST=$(unzip -l "$APK")
echo "$LIST" | grep -Eiq '\.(jks|keystore|der|p12|pem)$|google-services\.json|\.map$' && fail "arquivo sensível dentro do APK"

echo "APK aprovado: $PKG, certificado $GOT_FP"
echo "Permissões:"; echo "$PERMS" | sed 's/^/  /'

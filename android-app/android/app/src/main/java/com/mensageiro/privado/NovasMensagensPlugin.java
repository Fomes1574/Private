package com.mensageiro.privado;

import android.Manifest;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

// Notificação nativa no Android (FCM). O app só pede o token, entrega ao
// servidor e apaga quando a pessoa desliga ou o app é apagado. O aviso que
// chega não tem conteúdo; quem desenha a notificação é NovasMensagensService.
// Sem Firebase configurado no build (google-services.json ausente), diz
// "configured: false" e nada aqui toca no Firebase.
@CapacitorPlugin(
    name = "NovasMensagens",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notificacoes")
)
public class NovasMensagensPlugin extends Plugin {
    private boolean configured() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    private String permission() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "granted";
        if (Build.VERSION.SDK_INT < 33) return "denied"; // desligado nas configurações do sistema
        PermissionState s = getPermissionState("notificacoes");
        return s == PermissionState.DENIED ? "denied" : "prompt";
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("configured", configured());
        out.put("permission", permission());
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || "granted".equals(permission())) { status(call); return; }
        requestPermissionForAlias("notificacoes", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) { status(call); }

    @PluginMethod
    public void token(PluginCall call) {
        if (!configured()) { call.reject("not_configured"); return; }
        FirebaseMessaging fm = FirebaseMessaging.getInstance();
        fm.setAutoInitEnabled(true);
        fm.getToken().addOnCompleteListener((t) -> {
            if (!t.isSuccessful() || t.getResult() == null) { call.reject("token_failed"); return; }
            JSObject out = new JSObject();
            out.put("token", t.getResult());
            call.resolve(out);
        });
    }

    // Desligar: o token deixa de existir no Firebase e não renasce sozinho.
    @PluginMethod
    public void unregister(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancelAll();
        if (!configured()) { call.resolve(); return; }
        FirebaseMessaging fm = FirebaseMessaging.getInstance();
        fm.setAutoInitEnabled(false);
        fm.deleteToken().addOnCompleteListener((t) -> {
            if (t.isSuccessful()) call.resolve(); else call.reject("unregister_failed");
        });
    }
}

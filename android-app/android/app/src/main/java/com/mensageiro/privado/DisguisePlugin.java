package com.mensageiro.privado;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// E2: o disfarce troca o ícone e o nome na tela inicial. São duas entradas
// (activity-alias) para a mesma MainActivity; só uma fica ligada por vez.
// DONT_KILL_APP: o app continua aberto durante a troca.
@CapacitorPlugin(name = "Disguise")
public class DisguisePlugin extends Plugin {
    static final String PLAIN = "com.mensageiro.privado.PactoTalk";
    static final String SNAKE = "com.mensageiro.privado.HungrySnake";

    private void enable(String name, boolean on) {
        Context ctx = getContext();
        ctx.getPackageManager().setComponentEnabledSetting(new ComponentName(ctx, name),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        try {
            // Liga a nova antes de desligar a antiga: nunca fica sem ícone.
            enable(on ? SNAKE : PLAIN, true);
            enable(on ? PLAIN : SNAKE, false);
            JSObject r = new JSObject();
            r.put("on", on);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Não deu para trocar o ícone");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        Context ctx = getContext();
        int state = ctx.getPackageManager().getComponentEnabledSetting(new ComponentName(ctx, SNAKE));
        JSObject r = new JSObject();
        r.put("on", state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
        call.resolve(r);
    }
}

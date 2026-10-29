package com.mensageiro.privado;

import android.app.Activity;
import android.app.ActivityManager;
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

    static boolean isOn(Context ctx) {
        return ctx.getPackageManager().getComponentEnabledSetting(new ComponentName(ctx, SNAKE)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    // Nome da tarefa aberta (recentes e janelas do sistema que perguntam
    // "qual app é este"): segue o disfarce, mesmo que o app tenha sido aberto
    // pelo ícone antigo antes da troca.
    static void describeTask(Activity a) {
        if (a == null) return;
        try {
            String label = a.getString(isOn(a) ? R.string.system_name : R.string.title_activity_main);
            a.setTaskDescription(new ActivityManager.TaskDescription(label));
        } catch (Exception ignored) {}
    }

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
            Activity activity = getActivity();
            if (activity != null) activity.runOnUiThread(() -> describeTask(activity));
            JSObject r = new JSObject();
            r.put("on", on);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Não deu para trocar o ícone");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", isOn(getContext()));
        call.resolve(r);
    }
}

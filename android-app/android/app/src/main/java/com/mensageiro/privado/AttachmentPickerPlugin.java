package com.mensageiro.privado;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.util.Arrays;
import java.util.UUID;

// F17: só guarda a URI transitória, nunca copia para arquivo/cache. O retorno
// do seletor exige PIN+biometria novamente antes de liberar metadados/bytes.
@CapacitorPlugin(name = "AttachmentPicker")
public class AttachmentPickerPlugin extends Plugin {
    private Uri selected;
    private String token;
    private long selectedAt;
    private boolean authorized, picking;
    private InputStream stream;
    private long position;
    private static final long MAX_AGE = 5 * 60_000L;
    private static final int MAX_CHUNK = 192 * 1024;

    private void closeStream() {
        if (stream != null) { try { stream.close(); } catch (Exception ignored) {} }
        stream = null; position = 0;
    }
    private void reset() { closeStream(); selected = null; token = null; authorized = false; }
    private boolean permitted(PluginCall call) {
        if (!authorized || !getActivity().hasWindowFocus() || selected == null || token == null
                || !token.equals(call.getString("token")) || SystemClock.elapsedRealtime() - selectedAt > MAX_AGE) {
            call.reject("Seleção expirada ou app bloqueado"); return false;
        }
        return true;
    }
    @PluginMethod
    public void authorize(PluginCall call) { authorized = true; call.resolve(); }
    @PluginMethod
    public void clear(PluginCall call) { String expected = call.getString("token"); if (expected == null || expected.equals(token)) reset(); call.resolve(); }
    @PluginMethod
    public void pick(PluginCall call) {
        if (picking) { call.reject("Já há um seletor aberto"); return; }
        reset(); picking = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        String kind = call.getString("kind", "photo");
        intent.setType("photo".equals(kind) ? "image/*" : "video".equals(kind) ? "video/*" : "*/*");
        if ("doc".equals(kind)) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/markdown", "text/csv", "application/pdf"});
        if ("media".equals(kind)) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        // Não usa takePersistableUriPermission nem permissão de armazenamento.
        try { startActivityForResult(call, intent, "picked"); }
        catch (Exception e) { picking = false; reset(); call.reject("Seletor indisponível"); }
    }
    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        picking = false;
        if (call == null) { reset(); return; }
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        JSObject out = new JSObject();
        if (uri == null || !"content".equals(uri.getScheme())) { reset(); out.put("cancelled", true); call.resolve(out); return; }
        selected = uri; token = UUID.randomUUID().toString(); selectedAt = SystemClock.elapsedRealtime();
        out.put("token", token); call.resolve(out);
    }
    @PluginMethod
    public void describe(PluginCall call) {
        if (!permitted(call)) return;
        try (Cursor c = getContext().getContentResolver().query(selected, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (c == null || !c.moveToFirst() || c.isNull(1)) throw new Exception();
            long size = c.getLong(1);
            if (size <= 0 || size > 100L * 1024 * 1024) throw new Exception();
            JSObject out = new JSObject(); out.put("name", c.getString(0)); out.put("size", size);
            out.put("mime", getContext().getContentResolver().getType(selected)); call.resolve(out);
        } catch (Exception e) { reset(); call.reject("Não foi possível ler o tamanho do arquivo"); }
    }
    @PluginMethod
    public void read(PluginCall call) {
        if (!permitted(call)) return;
        int count = call.getInt("count", 0);
        long offset = call.getLong("offset", -1L);
        if (count <= 0 || count > MAX_CHUNK || offset != position) { call.reject("Leitura inválida"); return; }
        byte[] bytes = new byte[count];
        try {
            if (stream == null) stream = getContext().getContentResolver().openInputStream(selected);
            int used = 0;
            while (used < count) { int n = stream.read(bytes, used, count - used); if (n < 0) break; used += n; }
            position += used;
            JSObject out = new JSObject(); out.put("data", Base64.encodeToString(bytes, 0, used, Base64.NO_WRAP)); call.resolve(out);
        } catch (Exception e) { reset(); call.reject("Falha na leitura do arquivo"); }
        finally { Arrays.fill(bytes, (byte) 0); }
    }
    @Override protected void handleOnStop() { authorized = false; closeStream(); }
    @Override protected void handleOnDestroy() { reset(); }
}

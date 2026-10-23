package com.mensageiro.privado;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

// O aviso do servidor chega VAZIO (V6-021, D-028): sem texto, sem conversa,
// sem remetente, sem id de mensagem. O próprio app desenha sempre a mesma
// notificação, "novas mensagens", e uma só (substitui a anterior). Nada do
// aviso é lido, guardado ou repassado ao app web.
public class NovasMensagensService extends FirebaseMessagingService {
    static final String CHANNEL = "mensagens";
    private static final String TAG = "mp";
    private static final int ID = 1;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage ignored) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        if (!nm.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Mensagens", NotificationManager.IMPORTANCE_HIGH);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle("novas mensagens")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(pi);
        try { nm.notify(TAG, ID, b.build()); } catch (SecurityException e) { /* permissão retirada agora */ }
    }

    // Token novo: o app entrega ao servidor no próximo desbloqueio. Aqui não
    // se guarda nem se envia nada.
    @Override
    public void onNewToken(@NonNull String token) { }
}

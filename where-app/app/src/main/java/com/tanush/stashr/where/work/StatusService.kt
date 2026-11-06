package com.tanush.stashr.where.work

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.tanush.stashr.where.R
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.StatusText
import com.tanush.stashr.where.ui.MainActivity

/**
 * The quiet "Hello, connected to your home" notification that stays in the shade while the phone is linked (it can be switched off on the
 * main screen). It does no tracking itself: it only shows that Stashr Location is connected, and it also keeps phones that close
 * background apps (Xiaomi and others) from stopping the app.
 */
class StatusService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Prefs(this)
        if (!prefs.linked || !prefs.statusOn) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm?.createNotificationChannel(NotificationChannel(CHANNEL, "Connected to your home", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = StatusText.message(prefs.name)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle(StatusText.TITLE).setContentText(text)
            .setOngoing(true).setShowWhen(false).setContentIntent(open).setCategory(Notification.CATEGORY_SERVICE).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, n)
        } catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }

    companion object {
        private const val CHANNEL = "status"
        private const val ID = 4001

        /** Shows the notification when the phone is linked and it is switched on, removes it otherwise. Never throws (Android may refuse to start it from the background). */
        fun sync(ctx: Context) {
            val app = ctx.applicationContext
            val prefs = Prefs(app)
            try {
                val i = Intent(app, StatusService::class.java)
                if (prefs.linked && prefs.statusOn) app.startForegroundService(i) else app.stopService(i)
            } catch (_: Exception) { }
        }
    }
}

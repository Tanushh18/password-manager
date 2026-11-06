package com.tanush.stashr.where.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.app.Notification
import android.os.Build
import androidx.core.content.ContextCompat
import com.tanush.stashr.where.R
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.ui.MainActivity

/** Messages the server sends to this phone ("Open the door, Parveen arrived"). Tracking itself never notifies. */
object Notices {
    private const val CHANNEL = "messages"

    fun show(ctx: Context, notices: List<Pair<String, String>>) {
        if (notices.isEmpty()) return
        val prefs = Prefs(ctx)
        val seen = prefs.seenNotices.toMutableList()
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Stashr messages", NotificationManager.IMPORTANCE_DEFAULT))
        for ((id, text) in notices) {
            if (id in seen) continue
            seen.add(id)
            val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("Stashr").setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open).setAutoCancel(true).build()
            nm.notify(id.hashCode(), n)
        }
        prefs.seenNotices = seen
    }
}

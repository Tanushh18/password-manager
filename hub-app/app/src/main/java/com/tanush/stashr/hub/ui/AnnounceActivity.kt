package com.tanush.stashr.hub.ui

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.hub.R
import com.tanush.stashr.hub.core.Ui
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Shows what the server announces ("Parveen Chawla is arriving in 15 mins", "Open the door: Parveen arrived home") in
 * very large text, over the lock screen, and says it aloud once. Newest on top, earlier ones from the last 10 minutes
 * below. Closes after 30 s (60 s when urgent) or on a tap. A heads-up notification is always posted too, because
 * Android may refuse to open the screen from the background without "Display over other apps".
 */
class AnnounceActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var list: LinearLayout
    private val close = Runnable { finish() }
    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)
        if (android.os.Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        ui = Ui(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(ui.c.bg); gravity = Gravity.CENTER_VERTICAL
            setPadding(ui.dp(24), ui.dp(24), ui.dp(24), ui.dp(24))
            setOnClickListener { finish() }
        }
        root.addView(ui.eyebrow("Stashr Hub · ${timeFmt.format(Date())}"))
        list = ui.column(18)
        root.addView(list)
        root.addView(ui.dim("Tap anywhere to close"))
        setContentView(root)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); setIntent(intent); handle(intent) }

    private fun handle(i: Intent?) {
        i ?: return
        val text = i.getStringExtra(EXTRA_TEXT).orEmpty().take(200)
        if (text.isEmpty()) return
        val urgent = i.getBooleanExtra(EXTRA_URGENT, false)
        val now = System.currentTimeMillis()
        recent.removeAll { now - it.second > 10 * 60 * 1000 }
        recent.add(0, text to now)
        while (recent.size > 6) recent.removeAt(recent.size - 1)
        render()
        main.removeCallbacks(close)
        main.postDelayed(close, if (urgent) 60_000L else 30_000L)
    }

    private fun render() {
        list.removeAllViews()
        recent.forEachIndexed { idx, (t, at) ->
            if (idx == 0) {
                list.addView(TextView(this).apply {
                    text = t; textSize = 44f; setTextColor(ui.c.text); typeface = android.graphics.Typeface.DEFAULT_BOLD
                    setLineSpacing(0f, 1.1f)
                })
            } else {
                list.addView(ui.dim("${timeFmt.format(Date(at))}  $t"))
            }
        }
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_SPEAK = "speak"
        private const val EXTRA_URGENT = "urgent"
        private const val CHANNEL = "announcements"
        private const val NOTE_ID = 4242
        private val recent = ArrayList<Pair<String, Long>>()

        /** Opens the screen and posts the heads-up notification (the fallback when Android blocks the screen). */
        fun show(ctx: Context, text: String, speak: Boolean, urgent: Boolean) {
            val intent = Intent(ctx, AnnounceActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_TEXT, text).putExtra(EXTRA_SPEAK, speak).putExtra(EXTRA_URGENT, urgent)
            try { ctx.startActivity(intent) } catch (e: Exception) { /* the notification below still shows it */ }
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Announcements", NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(ctx, NOTE_ID, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            nm.notify(NOTE_ID, Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("Stashr Hub")
                .setContentText(text).setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open)
                .setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE).setTimeoutAfter(2 * 60 * 1000L).build())
        }
    }
}

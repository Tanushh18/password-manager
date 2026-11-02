package com.tanush.stashr.tv.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import com.tanush.stashr.tv.core.Ui

/**
 * A big banner at the top of the screen that shows over any app (Netflix, YouTube…) for 12 seconds. It needs
 * "Display over other apps"; without it a Toast is shown instead.
 */
object NoticeOverlay {
    private val main = Handler(Looper.getMainLooper())
    private var view: View? = null

    /** Shows [text]; returns the message to acknowledge with. */
    fun show(ctx: Context, text: String): String {
        val app = ctx.applicationContext
        val clean = text.take(200)
        val allowed = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(app)
        main.post {
            if (!allowed) { Toast.makeText(app, clean, Toast.LENGTH_LONG).show(); return@post }
            try {
                val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                view?.let { try { wm.removeView(it) } catch (e: Exception) { /* gone */ } }
                val ui = Ui(app)
                val tv = TextView(app).apply {
                    this.text = "🏠  $clean"; setTextColor(ui.text); setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
                    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); gravity = Gravity.CENTER_VERTICAL
                    background = ui.rounded(ui.withAlpha(ui.bg, 0.96f), ui.accent, 20, 3)
                    setPadding(ui.dp(36), ui.dp(24), ui.dp(36), ui.dp(24)); maxLines = 3
                }
                @Suppress("DEPRECATION")
                val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
                val lp = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP; x = 0; y = ui.dp(32); horizontalMargin = 0.04f }
                wm.addView(tv, lp)
                view = tv
                main.postDelayed({ if (view === tv) { try { wm.removeView(tv) } catch (e: Exception) { /* gone */ }; view = null } }, 12_000)
            } catch (e: Exception) { Toast.makeText(app, clean, Toast.LENGTH_LONG).show() }
        }
        return if (allowed) "Shown" else "Toast only: allow Display over other apps"
    }
}

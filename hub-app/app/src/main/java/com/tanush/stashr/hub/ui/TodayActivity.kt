package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Ui
import kotlin.concurrent.thread

/**
 * "Stashr, today updates": opens by itself on the tablet and lists what happened at home today (weather, who is home,
 * the TV, the Wi-Fi, events, internet speed). It refreshes every 30 seconds and closes itself after 2 minutes of no touch.
 */
class TodayActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var list: android.widget.LinearLayout
    private var lastTouch = System.currentTimeMillis()
    @Volatile private var alive = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        ui = Ui(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Hub"))
        col.addView(ui.h1("Today at home"))
        list = ui.column(8)
        val card = ui.card()
        card.addView(list)
        col.addView(card)
        col.addView(ui.quiet("Close") { finish() })
        setContentView(root)
        list.addView(ui.dim("Loading…"))
        refresh()
        idleCheck()
    }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); lastTouch = System.currentTimeMillis(); refresh() }
    override fun dispatchTouchEvent(ev: android.view.MotionEvent?): Boolean { lastTouch = System.currentTimeMillis(); return super.dispatchTouchEvent(ev) }
    override fun onDestroy() { alive = false; main.removeCallbacksAndMessages(null); super.onDestroy() }

    private fun refresh() {
        thread {
            try {
                val d = Api(this).today()
                val lines = d.optJSONArray("lines")
                main.post {
                    if (!alive) return@post
                    list.removeAllViews()
                    if (lines == null || lines.length() == 0) list.addView(ui.dim("Nothing to show yet."))
                    else for (i in 0 until lines.length()) {
                        val l = lines.getJSONObject(i)
                        list.addView(ui.body(l.optString("icon") + "  " + l.optString("text")))
                    }
                }
            } catch (e: Exception) {
                main.post { if (alive) { list.removeAllViews(); list.addView(ui.dim("Could not reach Stashr: " + (e.message ?: ""))) } }
            }
        }
        main.postDelayed({ if (alive) refresh() }, 30_000)
    }

    private fun idleCheck() {
        main.postDelayed({
            if (!alive) return@postDelayed
            if (System.currentTimeMillis() - lastTouch > 120_000) finish() else idleCheck()
        }, 10_000)
    }
}

package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.RoomLiveLogic
import com.tanush.stashr.hub.core.Ui
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * "Room Model": the room model of the family phones, live, in a developer-console look. A Start / Stop button for the whole model, and for
 * each phone the room, every room's share, and every number the model calculated (distance, networks heard, samples, both accuracies).
 * It draws what the server returns (GET /home/agent/room/live): the website shows the same numbers. Refreshes every 4 seconds.
 */
class RoomModelActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var col: LinearLayout
    @Volatile private var alive = true
    private var lastTouch = System.currentTimeMillis()
    private var message = ""
    private var view: RoomLiveLogic.View? = null

    private val bg = 0xFF0D1117.toInt(); private val panel = 0xFF161B22.toInt(); private val line = 0xFF30363D.toInt()
    private val text = 0xFFC9D1D9.toInt(); private val muted = 0xFF8B949E.toInt(); private val green = 0xFF3FB950.toInt(); private val blue = 0xFF58A6FF.toInt()
    private val amber = 0xFFD29922.toInt(); private val red = 0xFFF85149.toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        ui = Ui(this)
        val scroll = ScrollView(this).apply { setBackgroundColor(bg) }
        col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(ui.dp(24), ui.dp(24), ui.dp(24), ui.dp(24)) }
        scroll.addView(col, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
        draw()
        refresh()
    }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); lastTouch = System.currentTimeMillis(); refresh() }
    override fun dispatchTouchEvent(ev: android.view.MotionEvent?): Boolean { lastTouch = System.currentTimeMillis(); return super.dispatchTouchEvent(ev) }
    override fun onDestroy() { alive = false; main.removeCallbacksAndMessages(null); super.onDestroy() }

    private fun mono(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        this.text = s; textSize = size; setTextColor(color); typeface = Typeface.create(Typeface.MONOSPACE, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun box(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(14))
        background = GradientDrawable().apply { setColor(panel); setStroke(ui.dp(1), line); cornerRadius = ui.dp(8).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ui.dp(12) }
    }

    private fun draw() {
        col.removeAllViews()
        val v = view
        col.addView(mono("$ stashr room-model --live", 12f, muted))
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        head.addView(mono("● ", 22f, if (v?.running == true) green else muted, true))
        head.addView(mono("ROOM MODEL  ${v?.status ?: "…"}", 22f, text, true))
        col.addView(head)
        if (v != null) col.addView(mono(v.summary, 13f, blue))
        val btn = ui.primary(if (v?.running == true) "STOP MODEL" else "START MODEL") { toggle() }
        col.addView(btn)
        if (message.isNotEmpty()) col.addView(mono(message, 12f, amber))
        if (v == null) col.addView(mono("loading…", 13f, muted))
        v?.phones?.forEach { p ->
            val card = box()
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
            top.addView(mono(p.person, 16f, text, true).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
            top.addView(mono(if (p.on) "ON" else "OFF", 12f, if (p.on) green else muted, true))
            card.addView(top)
            card.addView(mono("> ${p.headline}", 24f, if (p.sure) green else if (p.on) amber else muted, true))
            p.bars.forEach { b -> card.addView(mono(String.format("%-10s %s %3d%%", b.label.take(10), RoomLiveLogic.bar(b.pct, 24), b.pct), 13f, if (b.pct == p.bars.maxOf { it.pct }) green else muted)) }
            if (p.warning.isNotEmpty()) card.addView(mono("! ${p.warning}", 12f, red))
            p.values.forEach { card.addView(mono("· $it", 12f, text)) }
            col.addView(card)
        }
        col.addView(ui.quiet("Close") { finish() })
    }

    private fun toggle() {
        val want = view?.running != true
        message = "…"; draw()
        thread {
            try {
                val r = Api(this).roomModel(want)
                val blocked = r.optJSONArray("blocked")
                val note = if (blocked != null && blocked.length() > 0) (0 until blocked.length()).joinToString("\n") { blocked.getJSONObject(it).let { b -> b.optString("person") + ": " + b.optString("why") } } else ""
                val parsed = RoomLiveLogic.parse(r.optJSONObject("live") ?: JSONObject())
                main.post { if (alive) { view = parsed; message = note; draw() } }
            } catch (e: Exception) { main.post { if (alive) { message = "Could not reach Stashr: " + (e.message ?: ""); draw() } } }
        }
    }

    private fun refresh() {
        thread {
            try {
                val parsed = RoomLiveLogic.parse(Api(this).roomLive())
                main.post { if (alive) { view = parsed; draw() } }
            } catch (e: Exception) { main.post { if (alive && view == null) { message = "Could not reach Stashr: " + (e.message ?: ""); draw() } } }
        }
        main.postDelayed({ if (alive) { if (System.currentTimeMillis() - lastTouch > 300_000) finish() else refresh() } }, 4_000)
    }
}

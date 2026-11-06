package com.tanush.stashr.tv.ui

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Ui
import com.tanush.stashr.tv.service.TvService
import kotlin.concurrent.thread

/**
 * "Live location": who in the family is out, where they are right now and the road home, refreshed every 5 seconds
 * while this screen is open (each refresh keeps their phones in fast mode on the server for 2 minutes; closing the
 * screen stops it). Nothing speaks. Back closes it.
 */
class LiveMapActivity : Activity() {
    private lateinit var ui: Ui
    private lateinit var mapView: LiveMapView
    private lateinit var list: LinearLayout
    private lateinit var emptyText: TextView
    private lateinit var chip: TextView
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var alive = false
    private var last: Logic.LiveMap? = null
    private val tick = Runnable { poll() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ui = Ui(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(ui.bg) }

        val left = FrameLayout(this)
        mapView = LiveMapView(this)
        left.addView(mapView, FrameLayout.LayoutParams(-1, -1))
        emptyText = TextView(this).apply {
            setTextColor(ui.text); textSize = 26f; gravity = Gravity.CENTER; setPadding(ui.dp(48), 0, ui.dp(48), 0); typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            text = "Looking for your family…"
        }
        left.addView(emptyText, FrameLayout.LayoutParams(-1, -1))
        root.addView(left, LinearLayout.LayoutParams(0, -1, 65f))

        val right = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(ui.dp(24), ui.dp(28), ui.dp(40), ui.dp(24)) }
        right.addView(ui.eyebrow("Stashr TV"))
        right.addView(ui.h1("Live location"))
        chip = ui.text("", 16f, ui.warn, bold = true).apply { visibility = View.GONE }
        right.addView(chip)
        list = ui.column(14).apply { setPadding(0, ui.dp(16), 0, 0) }
        right.addView(ScrollView(this).apply { addView(list); isFocusable = false })
        root.addView(right, LinearLayout.LayoutParams(0, -1, 35f))
        setContentView(root)
    }

    override fun onResume() { super.onResume(); alive = true; poll() }
    override fun onPause() { alive = false; main.removeCallbacks(tick); super.onPause() }

    private fun poll() {
        if (!alive) return
        if (TvService.localMode) {
            show(null, "Live location needs the internet", offline = true)
            main.postDelayed(tick, 5000); return
        }
        if (!com.tanush.stashr.tv.core.Prefs(this).linked) {
            show(null, "This TV is not linked yet.\nOpen Stashr TV settings and type the home-device code from the website.")
            main.postDelayed(tick, 5000); return
        }
        thread {
            var unlinked = false
            val result = try { Logic.parseLive(Api(this).tvLive()) } catch (e: com.tanush.stashr.tv.core.ApiError) { if (e.status == 401 || e.status == 403) unlinked = true; null } catch (e: Exception) { null }
            main.post {
                if (!alive) return@post
                if (unlinked) show(null, "This TV needs to be linked again.\nOpen Stashr TV settings and type a new home-device code.")
                else if (result != null) { last = result; show(result, null) } else show(last, null, noConnection = true)
                main.removeCallbacks(tick); main.postDelayed(tick, 5000)
            }
        }
    }

    private fun show(m: Logic.LiveMap?, message: String?, noConnection: Boolean = false, offline: Boolean = false) {
        chip.visibility = if (noConnection || offline) View.VISIBLE else View.GONE
        chip.text = if (offline) "●  Offline mode" else "●  No connection · showing the last picture"
        list.removeAllViews()
        if (m == null) {
            mapView.visibility = View.INVISIBLE
            emptyText.visibility = View.VISIBLE; emptyText.text = message ?: "Looking for your family…"
            return
        }
        val empty = !m.ok || m.home == null || m.devices.isEmpty()
        mapView.visibility = if (empty) View.INVISIBLE else View.VISIBLE
        emptyText.visibility = if (empty) View.VISIBLE else View.GONE
        if (empty) { emptyText.text = Logic.liveEmptyText(m); return }
        mapView.show(m)
        m.devices.forEachIndexed { i, d ->
            val card = ui.card().apply { setPadding(ui.dp(20), ui.dp(16), ui.dp(20), ui.dp(18)) }
            val head = ui.row(10)
            head.addView(View(this).apply { background = ui.rounded(mapView.colorFor(i), null, 7); layoutParams = LinearLayout.LayoutParams(ui.dp(14), ui.dp(14)) })
            head.addView(ui.fill(ui.text(d.name, 24f, ui.text, bold = true)))
            val coming = d.state == "coming"
            head.addView(ui.text(if (coming) "heading home" else "away", 14f, if (coming) ui.ok else ui.muted, bold = true).apply { background = ui.rounded(ui.sunken, if (coming) ui.ok else ui.lineStrong, 12); setPadding(ui.dp(12), ui.dp(4), ui.dp(12), ui.dp(4)) })
            card.addView(head)
            card.addView(ui.body(Logic.liveLine(d)))
            d.speedKmh?.let { card.addView(ui.dim("$it km/h")) }
            val col = when (Logic.freshness(d.ageSec)) { Logic.Freshness.FRESH -> ui.ok; Logic.Freshness.AMBER -> ui.warn; Logic.Freshness.RED -> ui.danger }
            card.addView(ui.text("updated " + Logic.ageText(d.ageSec), 16f, col, bold = true))
            if (!d.live) card.addView(ui.dim("Waiting for live updates…"))
            list.addView(card)
        }
    }
}

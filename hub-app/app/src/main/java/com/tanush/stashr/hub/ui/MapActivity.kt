package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.HouseMapLogic
import com.tanush.stashr.hub.core.Ui
import kotlin.concurrent.thread

/**
 * "Ghar ka map": the house as Stashr has learned it (zones from the Wi-Fi access points, who is where), in 2D or 3D. Refreshes every
 * 20 seconds and closes itself after 3 minutes without a touch.
 */
class MapActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var view: HouseMapView
    private lateinit var info: android.widget.TextView
    private var lastTouch = System.currentTimeMillis()
    @Volatile private var alive = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        ui = Ui(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Hub"))
        col.addView(ui.h1("Ghar ka map"))
        val bar = ui.row(8)
        bar.addView(ui.primary("2D") { view.threeD = false })
        bar.addView(ui.quiet("3D") { view.threeD = true })
        bar.addView(ui.quiet("Refresh") { refresh() })
        col.addView(bar)
        view = HouseMapView(this)
        view.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(440))
        col.addView(view)
        info = ui.dim("Loading…")
        col.addView(info)
        col.addView(ui.quiet("Close") { finish() })
        setContentView(root)
        // Without the location permission Android hides the Wi-Fi access point: ask once, with the reason on screen.
        if (android.os.Build.VERSION.SDK_INT >= 23 && checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            col.addView(ui.dim("To place the tablet on the map, Android needs the location permission (it only tells Stashr which Wi-Fi access point the tablet is on, never a position)."))
            col.addView(ui.quiet("Allow") { requestPermissions(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION), 7) })
        }
        refresh()
        idleCheck()
    }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); lastTouch = System.currentTimeMillis(); refresh() }
    override fun dispatchTouchEvent(ev: android.view.MotionEvent?): Boolean { lastTouch = System.currentTimeMillis(); return super.dispatchTouchEvent(ev) }
    override fun onDestroy() { alive = false; main.removeCallbacksAndMessages(null); super.onDestroy() }

    private fun refresh() {
        thread {
            try {
                val j = Api(this).houseMap()
                val blocks = HouseMapLogic.parse(j)
                val text = listOf(j.optString("note"), HouseMapLogic.awayLine(j)).filter { it.isNotEmpty() }.joinToString("\n")
                main.post { if (alive) { view.blocks = blocks; info.text = text } }
            } catch (e: Exception) {
                main.post { if (alive) info.text = "Could not reach Stashr: " + (e.message ?: "") }
            }
        }
        main.postDelayed({ if (alive) refresh() }, 20_000)
    }

    private fun idleCheck() {
        main.postDelayed({
            if (!alive) return@postDelayed
            if (System.currentTimeMillis() - lastTouch > 180_000) finish() else idleCheck()
        }, 10_000)
    }
}

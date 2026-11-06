package com.tanush.stashr.tv.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import com.tanush.stashr.tv.cast.CastHub
import com.tanush.stashr.tv.cast.CastListener

/**
 * The phone's screen, full screen on a black background, scaled to fit with the picture's own shape. It opens by itself when
 * a phone starts casting; Back (or the phone stopping) closes it. A line with the phone's name shows for 3 seconds.
 */
class CastReceiverActivity : Activity(), CastListener, SurfaceHolder.Callback {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: FrameLayout
    private lateinit var surfaceView: SurfaceView
    private lateinit var hud: TextView
    private var videoW = 0
    private var videoH = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        surfaceView = SurfaceView(this).apply { holder.addCallback(this@CastReceiverActivity); holder.setFormat(PixelFormat.OPAQUE) }
        root.addView(surfaceView, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        hud = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 18f; setPadding(32, 20, 32, 20); setBackgroundColor(Color.argb(140, 0, 0, 0)); visibility = View.GONE
        }
        root.addView(hud, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START))
        setContentView(root)
        hideBars()
        root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fit() }
        if (CastHub.session == null) { finish(); return }
        CastHub.listener = this
        CastHub.lastSize?.let { onSize(it.first, it.second) }
        showHud(CastHub.session?.hello?.let { "${it.name} · ${it.h}p · ${it.fps} fps" }.orEmpty())
    }

    private fun hideBars() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    }

    private fun showHud(text: String) {
        if (text.isEmpty()) return
        hud.text = text; hud.visibility = View.VISIBLE
        main.removeCallbacks(hideHud); main.postDelayed(hideHud, 3000)
    }
    private val hideHud = Runnable { hud.visibility = View.GONE }

    /** Fit the picture inside the screen, keeping its shape. */
    private fun fit() {
        val rw = root.width; val rh = root.height
        if (videoW <= 0 || videoH <= 0 || rw <= 0 || rh <= 0) return
        val scale = minOf(rw.toFloat() / videoW, rh.toFloat() / videoH)
        val w = (videoW * scale).toInt().coerceAtLeast(1); val h = (videoH * scale).toInt().coerceAtLeast(1)
        val lp = surfaceView.layoutParams as FrameLayout.LayoutParams
        if (lp.width != w || lp.height != h) { lp.width = w; lp.height = h; lp.gravity = Gravity.CENTER; surfaceView.layoutParams = lp }
    }

    override fun onSize(w: Int, h: Int) {
        videoW = w; videoH = h; fit()
        CastHub.session?.hello?.let { showHud("${it.name} · ${h}p · ${it.fps} fps") }
    }

    override fun onEnded(reason: String) { if (!isFinishing) finish() }

    override fun surfaceCreated(holder: SurfaceHolder) { CastHub.session?.decoder?.setSurface(holder.surface) }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}
    override fun surfaceDestroyed(holder: SurfaceHolder) { CastHub.session?.decoder?.setSurface(null) }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) hideBars() }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        if (CastHub.listener === this) CastHub.listener = null
        CastHub.stop("Closed on the TV")
        super.onDestroy()
    }
}

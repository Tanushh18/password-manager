package com.tanush.stashr.cast.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.DisplayMetrics
import android.view.Display
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.tanush.stashr.cast.BuildConfig
import com.tanush.stashr.cast.cast.CastService
import com.tanush.stashr.cast.cast.CastSession
import com.tanush.stashr.cast.core.Logic
import com.tanush.stashr.cast.core.Prefs
import com.tanush.stashr.cast.core.Ui
import com.tanush.stashr.cast.net.Handshake
import com.tanush.stashr.cast.net.TvFinder
import com.tanush.stashr.cast.update.Updater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.concurrent.thread

/**
 * The whole app on one screen: pick a TV (found on the Wi-Fi, or typed), pick the quality, press Start. The first time a TV shows a
 * 4-digit PIN to type; after that it remembers this phone. While casting the screen turns into a small status card with Stop.
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var ui: Ui
    private lateinit var prefs: Prefs
    private lateinit var finder: TvFinder
    private var shownCasting: Boolean? = null

    private class Target(val key: String, val name: String, val host: String, val port: Int)
    private var selected: Target? = null
    private var needPin = false
    private var busy = false

    private lateinit var tvList: LinearLayout
    private lateinit var pinBox: android.widget.EditText
    private lateinit var pinHint: TextView
    private lateinit var error: TextView
    private lateinit var startBtn: android.widget.Button
    private var statusLine: TextView? = null
    private var noteLine: TextView? = null
    private var quality = "sharp"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this); prefs = Prefs(this)
        quality = prefs.quality
        finder = TvFinder(this) { if (shownCasting == false) renderTvs() }
        render()
        tick()
        scope.launch { if (System.currentTimeMillis() - prefs.updateCheckedAt > 24 * 3600 * 1000L) { Updater.check(this@MainActivity); if (shownCasting == false) render() } }
    }

    override fun onStart() { super.onStart(); finder.start() }
    override fun onStop() { finder.stop(); super.onStop() }
    override fun onDestroy() { main.removeCallbacksAndMessages(null); scope.cancel(); super.onDestroy() }

    /** Once a second: switch between the setup card and the casting card, and keep the numbers fresh. */
    private fun tick() {
        if (shownCasting != CastSession.casting) render()
        if (CastSession.casting) {
            statusLine?.text = "Casting to ${CastSession.tvName} · ${CastSession.height.coerceAtMost(CastSession.width)}p${CastSession.fps} · ${Logic.kbpsText(CastSession.bytesPerSec)}" +
                if (CastSession.dropped > 0) " · ${CastSession.dropped} frames skipped to stay in sync" else ""
            noteLine?.text = CastSession.note
        }
        main.postDelayed({ tick() }, 1000)
    }

    /* ───────── screen ───────── */

    private fun render() {
        shownCasting = CastSession.casting
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Cast"))
        col.addView(ui.h1("Mirror your screen to the TV"))
        if (CastSession.casting) buildCasting(col) else buildSetup(col)

        val priv = ui.card("Private")
        priv.addView(ui.dim("Your screen goes straight to your TV over your Wi-Fi. Nothing is sent to the internet."))
        col.addView(priv)
        setContentView(root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON.takeIf { CastSession.casting } ?: 0)
        if (!CastSession.casting) renderTvs()
    }

    private fun buildCasting(col: LinearLayout) {
        val card = ui.card("Casting")
        statusLine = ui.body("")
        noteLine = ui.dim("")
        card.addView(statusLine); card.addView(noteLine)
        card.addView(ui.danger("Stop casting") { CastService.stop(this) })
        col.addView(card)
    }

    private fun buildSetup(col: LinearLayout) {
        statusLine = null; noteLine = null
        if (CastSession.error.isNotEmpty()) { col.addView(ui.card().apply { addView(ui.body(CastSession.error)) }); CastSession.error = "" }
        if (prefs.updateVersion.isNotEmpty()) {
            col.addView(ui.card("Update available", "Stashr Cast ${prefs.updateVersion} is ready.").apply {
                addView(ui.primary("Install update") { scope.launch { val m = Updater.install(this@MainActivity); toastLine(m) } })
            })
        }

        val tvs = ui.card("1 · Pick the TV", "Open Stashr TV on the TV. It shows up here by itself.")
        tvList = ui.column(8)
        tvs.addView(tvList)
        val addr = ui.input("TV address, e.g. 192.168.1.30", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val add = ui.quiet("Add by address") {
            val a = Logic.parseAddress(addr.text.toString())
            if (a == null) { error.text = "That does not look like an address."; return@quiet }
            val key = if (a.second == Logic.PORT) a.first else "${a.first}:${a.second}"
            prefs.manualTvs = prefs.manualTvs + key
            selected = Target(key, key, a.first, a.second); needPin = prefs.tokenFor(key).isEmpty()
            error.text = ""; addr.setText(""); renderTvs()
        }
        tvs.addView(addr); tvs.addView(add)
        pinHint = ui.dim("Type the 4-digit PIN the TV is showing.")
        pinBox = ui.input("PIN", type = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        pinBox.filters = arrayOf(android.text.InputFilter.LengthFilter(4))
        tvs.addView(pinHint); tvs.addView(pinBox)
        col.addView(tvs)

        val q = ui.card("2 · Quality")
        val chips = ui.row(8)
        val chipViews = Logic.QUALITIES.map { opt ->
            ui.chip(opt.label, if (opt.key == quality) ui.c.primary else null).apply {
                setPadding(ui.dp(16), ui.dp(8), ui.dp(16), ui.dp(8))
                setOnClickListener { quality = opt.key; prefs.quality = opt.key; render() }
            }
        }
        chipViews.forEach { chips.addView(it) }
        q.addView(chips)
        q.addView(ui.dim(when (quality) { "smooth" -> "Smooth: 60 frames a second where the phone can, about 6 Mbit/s. Best for games and scrolling."; "max" -> "Max: the sharpest picture, 16 Mbit/s. Needs a strong 5 GHz Wi-Fi."; else -> "Sharp: 30 frames a second at 10 Mbit/s. Good for video and photos." }))
        val sound = Switch(this).apply { text = "Send sound"; isChecked = prefs.sendSound; setTextColor(ui.c.text); setOnCheckedChangeListener { _, on -> prefs.sendSound = on } }
        if (Build.VERSION.SDK_INT < 29) { sound.isEnabled = false; sound.text = "Send sound (needs Android 10 or newer)"; sound.isChecked = false }
        q.addView(sound)
        col.addView(q)

        error = ui.text("", 13f, ui.c.danger)
        startBtn = ui.primary("Start mirroring") { start() }
        col.addView(error); col.addView(startBtn)
        updatePin()
    }

    private fun renderTvs() {
        if (!::tvList.isInitialized || CastSession.casting) return
        tvList.removeAllViews()
        val all = finder.list().map { Target(it.name, it.name, it.host, it.port) } +
            prefs.manualTvs.mapNotNull { k -> Logic.parseAddress(k)?.let { Target(k, k, it.first, it.second) } }
        if (selected == null) selected = all.firstOrNull { it.key == prefs.lastTv } ?: all.firstOrNull()
        if (selected != null && all.none { it.key == selected!!.key }) selected = all.firstOrNull()
        if (all.isEmpty()) tvList.addView(ui.dim("Looking for TVs on this Wi-Fi…"))
        for (t in all) {
            val on = t.key == selected?.key
            val row = ui.row(10).apply {
                background = ui.rounded(if (on) ui.withAlpha(ui.c.primary, 0.12f) else ui.c.sunken, if (on) ui.c.primary else ui.c.line, 10)
                setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
                setOnClickListener { selected = t; needPin = prefs.tokenFor(t.key).isEmpty(); renderTvs(); updatePin() }
            }
            row.addView(ui.dot(if (on) ui.c.primary else ui.c.lineStrong))
            val box = ui.column(2)
            box.addView(ui.body(t.name)); box.addView(ui.dim("${t.host}:${t.port}" + if (prefs.tokenFor(t.key).isNotEmpty()) " · remembered" else ""))
            row.addView(ui.fill(box))
            tvList.addView(row)
        }
        updatePin()
    }

    private fun updatePin() {
        if (!::pinBox.isInitialized) return
        val t = selected
        val show = t != null && (needPin || prefs.tokenFor(t.key).isEmpty())
        pinBox.visibility = if (show) View.VISIBLE else View.GONE
        pinHint.visibility = pinBox.visibility
    }

    private fun toastLine(s: String) { if (::error.isInitialized) error.text = s }

    /* ───────── start ───────── */

    private fun start() {
        val t = selected
        if (t == null) { error.text = "Pick a TV first."; return }
        if (busy) return
        val need = mutableListOf<String>()
        if (prefs.sendSound && Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS)
        if (need.isNotEmpty()) requestPermissions(need.toTypedArray(), REQ_PERMS) else connect()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) connect()      // the sound is optional; casting goes on without it
    }

    @Suppress("DEPRECATION")
    private fun realSize(): Triple<Int, Int, Float> {
        val d = (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
        val m = DisplayMetrics(); d.getRealMetrics(m)
        return Triple(m.widthPixels, m.heightPixels, d.refreshRate)
    }

    /** Talks to the TV first, so a wrong PIN shows up before the system's "start recording" dialog. */
    private fun connect() {
        val t = selected ?: return
        val q = Logic.qualityOf(quality)
        val (rw, rh, refresh) = realSize()
        val (w, h) = Logic.scaleTo(rw, rh)
        val fps = Logic.fpsFor(q, refresh)
        val pin = pinBox.text.toString().trim()
        val token = prefs.tokenFor(t.key)
        if (token.isEmpty() && !Regex("^\\d{4}$").matches(pin)) { needPin = true; updatePin(); error.text = "Type the 4-digit PIN the TV is showing."; return }
        val audio = prefs.sendSound && Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        busy = true; startBtn.isEnabled = false; startBtn.text = "Connecting…"; error.text = ""
        thread {
            try {
                val r = Handshake.connect(t.host, t.port, Build.MODEL ?: "Phone", if (token.isEmpty()) pin else null, token.ifEmpty { null }, w, h, fps, audio)
                main.post {
                    busy = false; startBtn.isEnabled = true; startBtn.text = "Start mirroring"
                    if (!r.reply.ok) {
                        if (r.reply.needsPin) { prefs.forgetToken(t.key); needPin = true; pinBox.setText(""); updatePin(); renderTvs() }
                        error.text = r.reply.error.ifEmpty { "The TV said no." }
                        return@post
                    }
                    r.reply.token?.let { prefs.saveToken(t.key, it) }
                    prefs.lastTv = t.key; needPin = false
                    CastSession.dropPending()
                    CastSession.pending = com.tanush.stashr.cast.cast.CastSession.Pending(r.socket, t.name, w, h, fps, q, audio)
                    @Suppress("DEPRECATION")
                    startActivityForResult((getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).createScreenCaptureIntent(), REQ_CAPTURE)
                }
            } catch (e: Exception) {
                main.post { busy = false; startBtn.isEnabled = true; startBtn.text = "Start mirroring"; error.text = e.message ?: "Could not connect to the TV." }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode == RESULT_OK && data != null) {
            CastService.start(this, resultCode, data)
            main.postDelayed({ if (!CastSession.casting) render() }, 1500)
        } else {
            CastSession.dropPending()
            error.text = "Android did not allow the screen to be recorded, so nothing was sent."
        }
    }

    companion object {
        private const val REQ_PERMS = 21
        private const val REQ_CAPTURE = 22
        @Suppress("unused") val VERSION = BuildConfig.VERSION_NAME
    }
}

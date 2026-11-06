package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.tanush.stashr.hub.R
import com.tanush.stashr.hub.core.HubService
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.core.SystemBars
import com.tanush.stashr.hub.core.Ui

/**
 * The Apps screen, opened from the Apps button on the Stashr home screen: the Stashr screens and the apps you pinned
 * (Stashr apps, WhatsApp, YouTube Music and so on). "All apps" shows everything installed; press and hold an app to pin it
 * to, or take it off, this list. It does not lock anything: every app is one tap away. Back returns to the home screen.
 */
class LauncherActivity : Activity() {
    private class App(val pkg: String, val label: String, val icon: Drawable, val intent: Intent)

    private lateinit var ui: Ui
    private lateinit var content: LinearLayout
    private val prefs by lazy { Prefs(this) }
    private val main = Handler(Looper.getMainLooper())
    private var showAll = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Not set up as the home tablet yet: the normal start screen (pairing) is the right place.
        if (!prefs.paired || prefs.role != "hub") { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        HubService.start(this)
        ui = Ui(this, dark = true)
        val (root, col) = ui.page()
        root.setBackgroundColor(Color.TRANSPARENT)
        col.setPadding(ui.dp(28), ui.dp(24), ui.dp(28), ui.dp(40))
        val head = ui.row(14)
        head.addView(ui.pill(null, "back") { finish() })
        head.addView(ImageView(this).apply { setImageResource(R.drawable.ic_brand); layoutParams = LinearLayout.LayoutParams(ui.dp(40), ui.dp(40)) })
        head.addView(ui.fill(ui.text("Apps", 28f, Color.WHITE, bold = true)))
        val btn = ui.pill("All apps", "apps") { showAll = !showAll; render() }
        head.addView(btn)
        toggleButton = btn
        col.addView(head)
        content = ui.column(16)
        col.addView(content)
        val frame = FrameLayout(this)
        frame.addView(AuroraView(this), FrameLayout.LayoutParams(-1, -1))
        frame.addView(root, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        render()
    }

    private var toggleButton: TextView? = null

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); if (::content.isInitialized) { showAll = false; render() } }

    override fun onResume() {
        super.onResume()
        if (!::content.isInitialized) return
        SystemBars.apply(this, prefs.hideStatusBar)
        render()
    }

    override fun onPause() { main.removeCallbacksAndMessages(null); super.onPause() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus && ::content.isInitialized) SystemBars.apply(this, prefs.hideStatusBar) }

    /** Back leaves the "All apps" list first, then returns to the home screen. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (showAll) { showAll = false; render() } else finish() }

    private fun defaults(): Set<String> = setOf(
        "com.whatsapp", "com.whatsapp.w4b", "com.google.android.apps.youtube.music", "com.google.android.youtube", "com.android.settings"
    )

    private fun isPinned(a: App, pins: Set<String>?) = if (pins != null) a.pkg in pins else a.pkg.startsWith("com.tanush.stashr") || a.pkg in defaults()

    private fun allApps(): List<App> {
        val pm = packageManager
        val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(q, 0)
            .filter { it.activityInfo.packageName != packageName }          // Stashr Hub has its own tiles
            .map { r ->
                val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(r.activityInfo.packageName, r.activityInfo.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                App(r.activityInfo.packageName, r.loadLabel(pm).toString(), r.loadIcon(pm), i)
            }
            .distinctBy { it.pkg }.sortedBy { it.label.lowercase() }
    }

    private fun render() {
        content.removeAllViews()
        toggleButton?.text = if (showAll) "Pinned" else "All apps"
        val apps = try { allApps() } catch (e: Exception) { emptyList() }
        val pins = prefs.homeApps
        if (!showAll) {
            content.addView(ui.text("STASHR", 12f, 0xB3FFFFFF.toInt(), bold = true).apply { letterSpacing = 0.14f })
            content.addView(grid(listOf(
                tile("Slideshow", null, "🖼", { open(Intent(this, SlideshowActivity::class.java)) }, null),
                tile("Today", null, "📅", { open(Intent(this, TodayActivity::class.java)) }, null)
            )))
            content.addView(ui.text("PINNED APPS", 12f, 0xB3FFFFFF.toInt(), bold = true).apply { letterSpacing = 0.14f })
            val mine = apps.filter { isPinned(it, pins) }
            content.addView(if (mine.isEmpty()) ui.text("No apps pinned. Open All apps and press and hold an app to add it here.", 14f, 0xCCFFFFFF.toInt()) else grid(mine.map { appTile(it, pins) }))
        } else {
            content.addView(ui.text("All apps. Press and hold an app to add it to, or take it off, the pinned list.", 14f, 0xCCFFFFFF.toInt()))
            content.addView(grid(apps.map { appTile(it, pins) }))
        }
    }

    private fun appTile(a: App, pins: Set<String>?): View {
        val pinned = isPinned(a, pins)
        return tile(a.label + if (showAll && pinned) "  ✓" else "", a.icon, null, { open(a.intent) }) {
            val now = (pins ?: allApps().filter { isPinned(it, null) }.map { it.pkg }.toSet()).toMutableSet()
            if (!now.remove(a.pkg)) now.add(a.pkg)
            prefs.homeApps = now
            Toast.makeText(this, if (a.pkg in now) "${a.label} added to the home screen" else "${a.label} removed from the home screen", Toast.LENGTH_SHORT).show()
            render()
        }
    }

    private fun open(i: Intent) {
        try { startActivity(i) } catch (e: ActivityNotFoundException) { Toast.makeText(this, "Could not open it", Toast.LENGTH_SHORT).show() } catch (e: SecurityException) { Toast.makeText(this, "Could not open it", Toast.LENGTH_SHORT).show() }
    }

    private fun tile(label: String, icon: Drawable?, emoji: String?, onClick: () -> Unit, onLong: (() -> Unit)?): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            background = ui.glass(18)
            setPadding(ui.dp(8), ui.dp(14), ui.dp(8), ui.dp(12))
            isClickable = true; isFocusable = true
            setOnClickListener { onClick() }
            if (onLong != null) setOnLongClickListener { onLong(); true }
        }
        if (icon != null) box.addView(ImageView(this).apply { setImageDrawable(icon); layoutParams = LinearLayout.LayoutParams(ui.dp(52), ui.dp(52)) })
        else box.addView(ui.text(emoji ?: "", 36f, Color.WHITE).apply { gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(ui.dp(52), ui.dp(52)) })
        box.addView(ui.text(label, 13f, Color.WHITE).apply { gravity = Gravity.CENTER; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, ui.dp(8), 0, 0) })
        return box
    }

    /** Tiles in rows; as many columns as fit the screen. */
    private fun grid(tiles: List<View>): View {
        val widthDp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        val cols = (widthDp / 130f).toInt().coerceIn(3, 8)
        val col = ui.column(10)
        for (r in tiles.chunked(cols)) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (k in 0 until cols) {
                val v = r.getOrNull(k) ?: android.widget.Space(this)   // a plain View with wrap_content would fill the whole screen height
                row.addView(v, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(ui.dp(5), 0, ui.dp(5), 0) })
            }
            col.addView(row)
        }
        return col
    }
}

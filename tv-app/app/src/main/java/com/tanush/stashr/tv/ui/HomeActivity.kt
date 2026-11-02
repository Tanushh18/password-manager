package com.tanush.stashr.tv.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.core.Ui
import com.tanush.stashr.tv.service.TvService
import com.tanush.stashr.tv.sync.Movie
import com.tanush.stashr.tv.sync.MovieStore
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The TV's home screen (it is the launcher): a clock and greeting, a row with every app, a row with the movies on the
 * USB drive, and a Stashr tile for settings. Everything is reachable with the remote's arrows and OK.
 */
class HomeActivity : Activity() {
    private lateinit var ui: Ui
    private val main = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private lateinit var date: TextView
    private lateinit var hello: TextView
    private lateinit var syncLine: TextView
    private lateinit var appsRow: LinearLayout
    private lateinit var moviesTitle: TextView
    private lateinit var moviesRow: LinearLayout
    private lateinit var moviesScroll: HorizontalScrollView
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
    @Volatile private var alive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this)
        setContentView(build())
    }

    override fun onResume() {
        super.onResume()
        alive = true
        val prefs = Prefs(this)
        if (!prefs.linked) { startActivity(Intent(this, SetupActivity::class.java)) } else TvService.start(this)
        loadApps(); loadMovies(); tick()
    }

    override fun onPause() { alive = false; main.removeCallbacksAndMessages(null); super.onPause() }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); appsRow.getChildAt(0)?.requestFocus() }

    @Deprecated("The launcher never closes")
    override fun onBackPressed() { /* this is the home screen: Back stays here */ }

    private fun build(): View {
        val scroll = android.widget.ScrollView(this).apply { setBackgroundColor(ui.bg); isFillViewport = true; clipChildren = false }
        val col = ui.column(20).apply { setPadding(ui.dp(56), ui.dp(36), ui.dp(0), ui.dp(40)); clipChildren = false }
        val head = ui.row(24).apply { setPadding(0, 0, ui.dp(56), 0) }
        val left = ui.column(4)
        hello = ui.text("", 22f, ui.muted); clock = ui.text("", 64f, ui.text, bold = true); date = ui.text("", 22f, ui.muted)
        left.addView(hello); left.addView(clock); left.addView(date)
        head.addView(ui.fill(left))
        syncLine = ui.text("", 20f, ui.accent).apply { gravity = Gravity.END }
        head.addView(syncLine)
        col.addView(head)

        col.addView(ui.h2("Apps"))
        appsRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        col.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(appsRow) })

        moviesTitle = ui.h2("Movies")
        moviesRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        moviesScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(moviesRow) }
        col.addView(moviesTitle); col.addView(moviesScroll)
        scroll.addView(col)
        return scroll
    }

    private fun tick() {
        val now = Date()
        clock.text = clockFmt.format(now); date.text = dateFmt.format(now)
        hello.text = Logic.greeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))
        val prefs = Prefs(this)
        val s = com.tanush.stashr.tv.service.TvService.syncer?.state
        syncLine.text = when {
            !prefs.linked -> "Not linked"
            s != null && s.active && s.name.isNotEmpty() && s.error.isEmpty() -> "Downloading ${Logic.title(s.name)} · ${s.pct}%"
            s != null && s.error.isNotEmpty() -> s.error.take(70)
            else -> ""
        }
        if (alive) main.postDelayed({ tick(); if (movieKey() != lastMovieKey) loadMovies() }, 2000)
    }

    private fun tile(w: Int, h: Int, label: String, sub: String?, image: Drawable?, onOpen: () -> Unit, onMenu: (() -> Unit)? = null): View {
        val box = ui.column(6).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT); clipChildren = false }
        val face = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(ui.dp(w), ui.dp(h)); background = ui.focusable(ui.surface, 14)
            isFocusable = true; isClickable = true; setPadding(ui.dp(6), ui.dp(6), ui.dp(6), ui.dp(6))
            setOnClickListener { onOpen() }
            if (onMenu != null) setOnLongClickListener { onMenu(); true }
            setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.08f else 1f).scaleY(if (f) 1.08f else 1f).setDuration(120).start(); v.elevation = if (f) ui.dp(10).toFloat() else 0f }
        }
        if (image != null) face.addView(ImageView(this).apply { setImageDrawable(image); scaleType = ImageView.ScaleType.FIT_CENTER }, FrameLayout.LayoutParams(-1, -1))
        else face.addView(ui.text(label.take(2).uppercase(), 40f, ui.accent, bold = true).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1))
        box.addView(face)
        box.addView(ui.text(label, 18f, ui.text).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER_HORIZONTAL; layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT) })
        if (sub != null) box.addView(ui.text(sub, 15f, ui.faint).apply { gravity = Gravity.CENTER_HORIZONTAL; layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT) })
        return box.also { it.tag = face }
    }

    private data class AppEntry(val pkg: String, val label: String, val image: Drawable?)

    private fun loadApps() {
        thread {
            val pm = packageManager
            fun query(category: String) = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(category), 0)
            val found = LinkedHashMap<String, AppEntry>()
            for (ri in query(Intent.CATEGORY_LEANBACK_LAUNCHER) + query(Intent.CATEGORY_LAUNCHER)) {
                val pkg = ri.activityInfo.packageName
                if (pkg == packageName || pkg in found) continue
                found[pkg] = AppEntry(pkg, ri.loadLabel(pm).toString(), ri.activityInfo.loadBanner(pm) ?: ri.loadIcon(pm))
            }
            val sorted = Logic.sortApps(found.values.toList(), { it.pkg }, { it.label })
            main.post {
                if (isFinishing) return@post
                val hadFocus = appsRow.focusedChild != null
                appsRow.removeAllViews()
                for (a in sorted) {
                    val t = tile(220, 124, a.label, null, a.image, { launch(a.pkg) })
                    appsRow.addView(t)
                }
                appsRow.addView(tile(220, 124, "Stashr", "Settings", null, { startActivity(Intent(this, SettingsActivity::class.java)) }))
                if (!hadFocus) (appsRow.getChildAt(0)?.tag as? View)?.requestFocus()
            }
        }
    }

    private fun launch(pkg: String) {
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
        if (i != null) try { startActivity(i) } catch (e: Exception) { android.widget.Toast.makeText(this, "Could not open that app", android.widget.Toast.LENGTH_SHORT).show() }
    }

    private var lastMovieKey = ""
    private fun movieKey() = MovieStore.list(this).joinToString("|") { it.name + it.size }

    private fun loadMovies() {
        thread {
            val list = MovieStore.list(this)
            main.post {
                if (isFinishing) return@post
                lastMovieKey = list.joinToString("|") { it.name + it.size }
                moviesRow.removeAllViews()
                val show = list.isNotEmpty()
                moviesTitle.visibility = if (show) View.VISIBLE else View.GONE
                moviesScroll.visibility = if (show) View.VISIBLE else View.GONE
                for (m in list) moviesRow.addView(tile(260, 146, Logic.title(m.name), Logic.size(m.size), null, { play(m) }, { confirmDelete(m) }))
            }
        }
    }

    private fun play(m: Movie) = startActivity(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_NAME, m.name))

    private fun confirmDelete(m: Movie) {
        AlertDialog.Builder(this).setTitle("Delete this movie?").setMessage(Logic.title(m.name) + " (" + Logic.size(m.size) + ") will be removed from this TV's storage.")
            .setPositiveButton("Delete") { _, _ -> thread { MovieStore.remove(this, m.name); main.post { loadMovies() } } }
            .setNegativeButton("Keep", null).show()
    }

}

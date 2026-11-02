package com.tanush.stashr.tv.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.tv.core.Api
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
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The TV's home screen (it is the launcher): a clock and greeting, a row with every app, a row with the movies on the
 * USB drive, and a Stashr tile for settings. Everything is reachable with the remote's arrows and OK.
 */
class HomeActivity : Activity() {
    private lateinit var ui: Ui
    private val main = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private lateinit var offlineChip: TextView
    private lateinit var date: TextView
    private lateinit var hello: TextView
    private lateinit var syncLine: TextView
    private lateinit var appsRow: LinearLayout
    private lateinit var moviesTitle: TextView
    private lateinit var moviesRow: LinearLayout
    private lateinit var moviesScroll: HorizontalScrollView
    private lateinit var weatherChip: TextView
    private lateinit var comingBox: LinearLayout
    private lateinit var nightTitle: TextView
    private lateinit var nightRow: LinearLayout
    private lateinit var nightScroll: HorizontalScrollView
    private lateinit var newsTitle: TextView
    private lateinit var newsRow: LinearLayout
    private lateinit var newsScroll: HorizontalScrollView
    private lateinit var morning: LinearLayout
    private var tvHome: Logic.TvHome? = null
    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val screenOn = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { if (alive) { refreshHome(); maybeMorning() } }
    }
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
    @Volatile private var alive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this)
        setContentView(build())
        tvHome = try { Prefs(this).takeIf { com.tanush.stashr.tv.core.LocalPolicy.homeFresh(it.homeCacheAt, System.currentTimeMillis()) }?.homeCache?.takeIf { it.isNotEmpty() }?.let { Logic.parseTvHome(JSONObject(it)) } } catch (e: Exception) { null }
        renderHome()
        androidx.core.content.ContextCompat.registerReceiver(this, screenOn, IntentFilter(Intent.ACTION_SCREEN_ON), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onDestroy() { try { unregisterReceiver(screenOn) } catch (e: Exception) { /* not registered */ }; super.onDestroy() }

    override fun onResume() {
        super.onResume()
        alive = true
        val prefs = Prefs(this)
        if (!prefs.linked) { startActivity(Intent(this, SetupActivity::class.java)) } else TvService.start(this)
        loadApps(); loadMovies(); tick(); refreshHome(); maybeMorning()
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
        offlineChip = ui.text("", 18f, ui.accent, bold = true).apply { visibility = View.GONE }
        left.addView(hello); left.addView(clock); left.addView(date); left.addView(offlineChip)
        head.addView(ui.fill(left))
        val right = ui.column(6).apply { gravity = Gravity.END }
        weatherChip = ui.text("", 24f, ui.text, bold = true).apply { gravity = Gravity.END }
        syncLine = ui.text("", 20f, ui.accent).apply { gravity = Gravity.END }
        right.addView(weatherChip); right.addView(syncLine)
        head.addView(right)
        col.addView(head)

        comingBox = ui.column(4).apply {
            background = ui.rounded(ui.withAlpha(ui.ok, 0.18f), ui.ok, 16, 2); setPadding(ui.dp(28), ui.dp(16), ui.dp(28), ui.dp(16)); visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = ui.dp(56) }
        }
        col.addView(comingBox)

        nightTitle = ui.h2("Aaj movie night?")
        nightRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        nightScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(nightRow) }
        col.addView(nightTitle); col.addView(nightScroll)
        nightTitle.visibility = View.GONE; nightScroll.visibility = View.GONE

        col.addView(ui.h2("Apps"))
        appsRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        col.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(appsRow) })

        newsTitle = ui.h2("Headlines")
        newsRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        newsScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(newsRow) }
        col.addView(newsTitle); col.addView(newsScroll)
        newsTitle.visibility = View.GONE; newsScroll.visibility = View.GONE

        moviesTitle = ui.h2("Movies")
        moviesRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        moviesScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(moviesRow) }
        col.addView(moviesTitle); col.addView(moviesScroll)
        scroll.addView(col)
        morning = ui.column(18).apply {
            setBackgroundColor(ui.bg); setPadding(ui.dp(96), ui.dp(64), ui.dp(96), ui.dp(48)); visibility = View.GONE; isFocusable = true; isClickable = true
        }
        val root = FrameLayout(this)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        root.addView(morning, FrameLayout.LayoutParams(-1, -1))
        return root
    }

    /* ───────── weather, headlines, movie night, who is coming ───────── */

    private fun refreshHome() {
        if (!Prefs(this).linked) return
        thread {
            try {
                val j = Api(this).tvHome()
                Prefs(this).homeCache = j.toString(); Prefs(this).homeCacheAt = System.currentTimeMillis()
                val parsed = Logic.parseTvHome(j)
                main.post { tvHome = parsed; renderHome(); maybeMorning() }
            } catch (e: Exception) { /* keep what is on screen */ }
        }
        main.removeCallbacks(homeTimer)
        if (alive) main.postDelayed(homeTimer, 15 * 60_000L)
    }
    private val homeTimer = Runnable { refreshHome() }

    private fun renderHome() {
        val h = tvHome
        weatherChip.text = h?.weather?.let { Logic.weatherLine(it) } ?: ""
        comingBox.removeAllViews()
        comingBox.visibility = if (h != null && h.coming.isNotEmpty()) View.VISIBLE else View.GONE
        h?.coming?.forEach { c ->
            comingBox.addView(ui.text("🚗  " + Logic.comingLine(c), 30f, ui.text, bold = true))
            if (c.km > 0) comingBox.addView(ui.text("%.1f km door".format(c.km), 18f, ui.muted))
        }
        newsRow.removeAllViews()
        val news = h?.news.orEmpty()
        newsTitle.visibility = if (news.isEmpty()) View.GONE else View.VISIBLE
        newsScroll.visibility = newsTitle.visibility
        for (n in news) newsRow.addView(headlineCard(n))
        renderNight()
    }

    private fun headlineCard(n: Logic.Headline): View = ui.column(8).apply {
        layoutParams = LinearLayout.LayoutParams(ui.dp(420), ui.dp(130))
        background = ui.focusable(ui.surface, 14); isFocusable = true; setPadding(ui.dp(20), ui.dp(14), ui.dp(20), ui.dp(14))
        addView(ui.text(n.title, 20f, ui.text, bold = true).apply { maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.END })
        if (n.source.isNotEmpty()) addView(ui.text(n.source, 15f, ui.faint))
        setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.05f else 1f).scaleY(if (f) 1.05f else 1f).setDuration(120).start() }
    }

    private fun renderNight() {
        val list = MovieStore.list(this)
        val on = tvHome?.movieNight == true && list.isNotEmpty()
        nightTitle.visibility = if (on) View.VISIBLE else View.GONE
        nightScroll.visibility = nightTitle.visibility
        nightRow.removeAllViews()
        if (on) for (m in list) nightRow.addView(tile(260, 146, Logic.title(m.name), Logic.size(m.size), null, { play(m) }, { confirmDelete(m) }))
    }

    /** First time the launcher is on screen each morning (05:00-10:59): weather and the top headlines for 30 seconds. */
    private fun maybeMorning() {
        val h = tvHome ?: return
        if (!alive || morning.visibility == View.VISIBLE) return
        val prefs = Prefs(this)
        val today = dayFmt.format(Date())
        if (!Logic.shouldShowMorning(Calendar.getInstance().get(Calendar.HOUR_OF_DAY), today, prefs.morningShown)) return
        if (h.weather == null && h.news.isEmpty()) return
        prefs.morningShown = today
        morning.removeAllViews()
        morning.addView(ui.text("Good morning", 56f, ui.text, bold = true))
        morning.addView(ui.text(dateFmt.format(Date()), 26f, ui.muted))
        h.weather?.let { w ->
            morning.addView(ui.text("${w.temp}°C  ·  ${w.text}", 44f, ui.accent, bold = true))
            morning.addView(ui.text(listOfNotNull(if (w.city.isNotBlank()) w.city else null, "${w.min}–${w.max}°C today", w.rainChance?.let { "$it% chance of rain" }).joinToString("  ·  "), 24f, ui.muted))
        }
        if (h.news.isNotEmpty()) {
            morning.addView(ui.text("Headlines", 28f, ui.text, bold = true))
            h.news.take(5).forEach { n -> morning.addView(ui.text("•  " + n.title + (if (n.source.isNotEmpty()) "  (${n.source})" else ""), 24f, ui.text).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }) }
        }
        morning.addView(ui.text("Press any button to close", 18f, ui.faint))
        morning.visibility = View.VISIBLE
        morning.requestFocus()
        main.postDelayed({ morning.visibility = View.GONE }, 30_000)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (morning.visibility == View.VISIBLE) { if (event.action == KeyEvent.ACTION_DOWN) morning.visibility = View.GONE; return true }
        return super.dispatchKeyEvent(event)
    }

    private fun tick() {
        val now = Date()
        clock.text = clockFmt.format(now); date.text = dateFmt.format(now)
        hello.text = Logic.greeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))
        val prefs = Prefs(this)
        val local = com.tanush.stashr.tv.service.TvService.localMode
        offlineChip.visibility = if (local) View.VISIBLE else View.GONE
        if (local) offlineChip.text = "●  Offline mode · working through the tablet"
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
                appsRow.addView(tile(220, 124, "Live location", "Who is out", null, { startActivity(Intent(this, LiveMapActivity::class.java)) }))
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
                renderNight()
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

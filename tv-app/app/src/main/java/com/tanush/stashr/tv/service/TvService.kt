package com.tanush.stashr.tv.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.net.Uri
import android.os.IBinder
import android.os.PowerManager
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.tanush.stashr.tv.BuildConfig
import com.tanush.stashr.tv.access.RemoteAccessibilityService
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.ApiError
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.overlay.NoticeOverlay
import com.tanush.stashr.tv.sync.MovieStore
import com.tanush.stashr.tv.sync.MovieSync
import com.tanush.stashr.tv.sync.movieJson
import com.tanush.stashr.tv.ui.HomeActivity
import com.tanush.stashr.tv.ui.PlayerActivity
import com.tanush.stashr.tv.update.Updater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/** What the built-in player is doing, for the status the website shows. */
object NowPlaying {
    @Volatile var title: String = ""
    @Volatile var playing: Boolean = false
}

/**
 * The always-on part: reports this TV to Stashr every ~20 s while the screen is on (and at once on a change), runs the
 * commands that come back, syncs the movies on start / every 30 minutes / on request, and checks for app updates daily.
 */
class TvService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val poke = Channel<Unit>(Channel.CONFLATED)
    private val syncPoke = Channel<Unit>(Channel.CONFLATED)
    private val acks = JSONArray()
    @Volatile private var screenOn = true
    @Volatile private var leftSent = false
    private lateinit var prefs: Prefs
    private lateinit var movies: MovieSync

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                Intent.ACTION_SCREEN_OFF -> { screenOn = false; scope.launch { sendLeaving() } }
                Intent.ACTION_SCREEN_ON -> { screenOn = true; leftSent = false; poke.trySend(Unit) }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
        prefs = Prefs(this)
        movies = MovieSync(this)
        syncer = movies
        screenOn = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
        ContextCompat.registerReceiver(this, screenReceiver, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) }, ContextCompat.RECEIVER_NOT_EXPORTED)
        scope.launch { reportLoop() }
        scope.launch { syncLoop() }
        scope.launch { updateLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ch = "tv"
        val nm = getSystemService(NotificationManager::class.java)
        if (android.os.Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(ch) == null) nm.createNotificationChannel(NotificationChannel(ch, "Stashr TV", NotificationManager.IMPORTANCE_MIN))
        val n: Notification = NotificationCompat.Builder(this, ch).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Stashr TV")
            .setContentText("Connected to your Stashr home").setPriority(NotificationCompat.PRIORITY_MIN).setOngoing(true).build()
        try {
            ServiceCompat.startForeground(this, 1, n, if (android.os.Build.VERSION.SDK_INT >= 34) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        } catch (e: Exception) { prefs.lastError = "Could not stay in the foreground: " + (e.message ?: "") }
        when (intent?.action) {
            ACTION_SYNC -> syncPoke.trySend(Unit)
            ACTION_REPORT -> poke.trySend(Unit)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = null
        try { unregisterReceiver(screenReceiver) } catch (e: Exception) { /* not registered */ }
        scope.cancel()
        super.onDestroy()
    }

    /* ───────── report ───────── */

    private suspend fun reportLoop() {
        while (true) {
            if (prefs.linked && screenOn) {
                try { report(leaving = false) } catch (e: ApiError) { handleError(e) } catch (e: Exception) { prefs.lastError = e.message ?: "Could not reach Stashr" }
            }
            withTimeoutOrNull(if (screenOn) 20_000 else 60_000) { poke.receive() }
        }
    }

    private fun handleError(e: ApiError) {
        prefs.lastError = e.message ?: "Error"
        if (e.status == 401) { prefs.unlink(); prefs.lastError = "Stashr removed this TV. Link it again in Settings." }
    }

    private fun status(): JSONObject {
        val st = JSONObject().put("agent", "stashr-tv").put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
            .put("deviceName", prefs.deviceName).put("screen", if (screenOn) "on" else "off")
        val fg = RemoteAccessibilityService.foreground
        if (NowPlaying.title.isNotEmpty()) {
            st.put("app", JSONObject().put("label", "Stashr TV").put("package", packageName))
            st.put("media", JSONObject().put("title", NowPlaying.title).put("state", if (NowPlaying.playing) "playing" else "paused"))
        } else if (fg != null) st.put("app", JSONObject().put("label", fg.second).put("package", fg.first))
        st.put("movies", movieJson(MovieStore.list(this)))
        if (prefs.lastUploadAt > 0) st.put("upload", JSONObject().put("lastAt", prefs.lastUploadAt).put("lastName", prefs.lastUploadName))
        val s = movies.state
        if (s.active) st.put("sync", JSONObject().put("active", true).put("name", s.name).put("pct", s.pct))
        return st
    }

    private suspend fun sendLeaving() {
        if (!prefs.linked || leftSent) return
        leftSent = true
        try { Api(this).report(JSONObject().put("status", JSONObject().put("agent", "stashr-tv").put("screen", "off").put("deviceName", prefs.deviceName)).put("leaving", true)) } catch (e: Exception) { /* offline */ }
    }

    private fun report(leaving: Boolean) {
        val body = JSONObject().put("status", status())
        val sending: JSONArray
        synchronized(acks) { sending = JSONArray(acks.toString()); }
        if (sending.length() > 0) body.put("acks", sending)
        if (leaving) body.put("leaving", true)
        val res = Api(this).report(body)
        synchronized(acks) { for (i in 0 until sending.length()) if (acks.length() > 0) acks.remove(0) }
        prefs.lastReportOk = System.currentTimeMillis(); prefs.lastError = ""
        val cmds = res.optJSONArray("commands") ?: return
        for (i in 0 until cmds.length()) cmds.optJSONObject(i)?.let { handle(it) }
        if (cmds.length() > 0) poke.trySend(Unit)
    }

    private fun ack(id: String, ok: Boolean, message: String) = synchronized(acks) { acks.put(JSONObject().put("id", id).put("ok", ok).put("message", message.take(200))) }

    /* ───────── commands ───────── */

    private fun handle(c: JSONObject) {
        val id = c.optString("id"); val args = c.optJSONObject("args") ?: JSONObject()
        try { ack(id, true, run(c.optString("type"), args)) } catch (e: Exception) { ack(id, false, e.message ?: "Failed") }
    }

    private fun startOnTv(i: Intent) { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }

    private fun run(type: String, a: JSONObject): String {
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return when (type) {
            "launch_app" -> {
                val pkg = a.optString("package")
                val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg) ?: throw IllegalStateException("That app is not installed on this TV")
                startOnTv(i); "Opened $pkg"
            }
            "volume" -> {
                if (Logic.isMute(a)) { audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI); "Mute toggled" }
                else {
                    val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    val target = Logic.volumeTarget(a, audio.getStreamVolume(AudioManager.STREAM_MUSIC), max) ?: throw IllegalArgumentException("Bad volume command")
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI); "Volume $target of $max"
                }
            }
            "media" -> {
                val code = when (a.optString("action")) { "play_pause" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; "next" -> KeyEvent.KEYCODE_MEDIA_NEXT; "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS; else -> throw IllegalArgumentException("Bad media command") }
                audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code)); audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code)); "Sent ${a.optString("action")}"
            }
            "key" -> when (a.optString("key")) {
                "HOME" -> if (RemoteAccessibilityService.home()) "Home" else { startOnTv(Intent(this, HomeActivity::class.java)); "Home (Stashr launcher)" }
                "BACK" -> if (RemoteAccessibilityService.back()) "Back" else throw IllegalStateException("Turn on “Stashr TV remote” in Accessibility settings to press Back")
                else -> throw IllegalArgumentException("Bad key")
            }
            "open_url" -> {
                val url = a.optString("url")
                if (!url.startsWith("https://")) throw IllegalArgumentException("Only https links")
                val view = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                try { startOnTv(Intent(view).setPackage(Logic.youtubePackage(url))) } catch (e: Exception) { startOnTv(view) }
                "Opened the link"
            }
            "sync_now" -> { syncPoke.trySend(Unit); "Syncing" }
            "remove_movie" -> if (MovieStore.remove(this, a.optString("name"))) "Removed" else throw IllegalStateException("That movie is not on this TV")
            "play_movie" -> {
                val m = MovieStore.find(this, a.optString("name")) ?: throw IllegalStateException("That movie is not on this TV")
                startOnTv(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_NAME, m.name)); "Playing ${m.name}"
            }
            "notify" -> NoticeOverlay.show(this, a.optString("text"))
            else -> throw IllegalArgumentException("This app version does not know “$type”")
        }
    }

    /* ───────── movies and updates ───────── */

    private suspend fun syncLoop() {
        delay(8_000)
        while (true) {
            if (prefs.linked && online()) movies.runOnce { poke.trySend(Unit) }
            withTimeoutOrNull(30 * 60_000L) { syncPoke.receive() }
        }
    }

    private suspend fun updateLoop() {
        delay(30_000)
        while (true) {
            if (prefs.linked && online()) Updater.check(this, manual = false)
            delay(24 * 3600_000L)
        }
    }

    private fun online(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        return cm.activeNetworkInfo?.isConnected == true
    }

    companion object {
        const val ACTION_SYNC = "com.tanush.stashr.tv.SYNC"
        const val ACTION_REPORT = "com.tanush.stashr.tv.REPORT"
        @Volatile var running: TvService? = null
        @Volatile var syncer: MovieSync? = null

        fun start(ctx: Context) { try { ContextCompat.startForegroundService(ctx, Intent(ctx, TvService::class.java)) } catch (e: Exception) { Prefs(ctx).lastError = "Could not start: " + (e.message ?: "") } }
        fun syncNow(ctx: Context) { try { ContextCompat.startForegroundService(ctx, Intent(ctx, TvService::class.java).setAction(ACTION_SYNC)) } catch (e: Exception) { /* not allowed now */ } }
        fun reportNow(ctx: Context) { try { ContextCompat.startForegroundService(ctx, Intent(ctx, TvService::class.java).setAction(ACTION_REPORT)) } catch (e: Exception) { /* not allowed now */ } }
    }
}

/** Starts the service after a restart or an update (Android 15 may refuse this one; the launcher starts it then). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { if (Prefs(ctx).linked) TvService.start(ctx) }
}

package com.tanush.stashr.hub.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.tanush.stashr.hub.BuildConfig
import com.tanush.stashr.hub.R
import com.tanush.stashr.hub.camera.CameraWatch
import com.tanush.stashr.hub.local.LocalMode
import com.tanush.stashr.hub.local.LocalServer
import com.tanush.stashr.hub.local.MediaQueue
import com.tanush.stashr.hub.net.LanScanner
import com.tanush.stashr.hub.net.ScanResult
import com.tanush.stashr.hub.net.SpeedResult
import com.tanush.stashr.hub.net.SpeedTest
import com.tanush.stashr.hub.net.WakeOnLan
import com.tanush.stashr.hub.ui.DashboardActivity
import com.tanush.stashr.hub.ui.SlideshowActivity
import com.tanush.stashr.hub.update.Updater
import com.tanush.stashr.hub.voice.Music
import com.tanush.stashr.hub.voice.VoiceListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * The home tablet's always-on part. Every minute it scans the Wi-Fi, reports to Stashr and runs the commands that
 * come back (Wi-Fi scan, speed test, Wake-on-LAN, music, camera, slideshow, update check). It also runs the camera
 * watch and the "Hey Stashr" listener, which need a foreground service to keep working with the screen off.
 */
class HubService : LifecycleService() {
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var lastScan: ScanResult? = null
    private var lastPortsAt = 0L
    private var lastSpeed: SpeedResult? = null
    private var lastSpeedAt = 0L
    private var lastUpdateCheck = 0L
    private val acks = JSONArray()
    private var wakeLock: PowerManager.WakeLock? = null
    private var firstFailAt = 0L
    private var lastDashboardAt = 0L

    override fun onCreate() {
        super.onCreate()
        running = this
        startInForeground()
        wakeLock = getSystemService(PowerManager::class.java)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "stashr:hub")?.apply { setReferenceCounted(false); acquire() }
        CameraWatch.start(this)
        VoiceListener.start(this)
        LocalServer.ensureStarted(this)
        lifecycleScope.launch { loop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_REPORT_NOW) wake.trySend(Unit)
        return START_STICKY
    }

    override fun onDestroy() {
        CameraWatch.stop()
        VoiceListener.stop()
        LocalServer.stop()
        wakeLock?.release()
        running = null
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Stashr Hub", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, DashboardActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("Stashr Hub is looking after your home")
            .setContentText("Wi-Fi, camera and voice").setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            if (Build.VERSION.SDK_INT >= 30) {
                if (granted(android.Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                if (granted(android.Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            startForeground(NOTE_ID, n, types)
        } else startForeground(NOTE_ID, n)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == android.content.pm.PackageManager.PERMISSION_GRANTED

    private suspend fun loop() {
        val api = Api(this)
        while (true) {
            try {
                if (!Prefs(this).paired) { stopSelf(); return }
                val now = System.currentTimeMillis()
                val withPorts = now - lastPortsAt > 30 * 60_000
                lastScan = withContext(Dispatchers.IO) { LanScanner.scan(this@HubService, withPorts) }
                if (withPorts) lastPortsAt = now
                lastScan?.let { LocalMode.onScan(this@HubService, it) }
                if (now - lastSpeedAt > 60 * 60_000) runSpeedTest()
                if (now - lastUpdateCheck > 6 * 3600_000) { lastUpdateCheck = now; lifecycleScope.launch { Updater.check(this@HubService, manual = false) } }
                val report = buildReport()
                val sentEvents = report.optJSONArray("localEvents")?.length() ?: 0
                val res = withContext(Dispatchers.IO) { api.report(report) }
                synchronized(acks) { while (acks.length() > 0) acks.remove(0) }
                // The server answered: local mode ends, what happened meanwhile is handed over.
                firstFailAt = 0L
                if (sentEvents > 0) LocalMode.eventsSent(this@HubService, sentEvents)
                res.optJSONObject("local")?.optString("key")?.takeIf { it.length >= 16 }?.let { if (Prefs(this).localKey != it) Prefs(this).localKey = it; LocalServer.ensureStarted(this) }
                if (LocalMode.offline) { LocalMode.setOffline(this, false); lifecycleScope.launch(Dispatchers.IO) { MediaQueue.flush(this@HubService) } }
                else if (now - lastDashboardAt > 5 * 60_000) { lastDashboardAt = now; withContext(Dispatchers.IO) { try { LocalMode.saveDashboard(this@HubService, api.dashboard().toString()); MediaQueue.flush(this@HubService) } catch (e: Exception) { } } }
                lastReport = now
                lastError = ""
                Health.success("report")
                val cmds = res.optJSONArray("commands") ?: JSONArray()
                for (i in 0 until cmds.length()) handle(cmds.getJSONObject(i))
            } catch (e: ApiError) {
                lastError = e.message ?: "Server error"
                Health.noteStreak("report", "Report to Stashr failed 3 times in a row: $lastError")
                if (e.status == 401) { Prefs(this).forget(); stopSelf(); return }
                if (e.status >= 500) serverDown()
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
                Health.noteStreak("report", "Report to Stashr failed 3 times in a row: $lastError")
                if (e is java.io.IOException) serverDown()
            }
            withTimeoutOrNull(60_000) { wake.receive() }
        }
    }

    /** The server did not answer: after 90 seconds of that in a row the tablet switches to local mode. */
    private fun serverDown() {
        val now = System.currentTimeMillis()
        if (firstFailAt == 0L) firstFailAt = now
        if (now - firstFailAt >= 90_000) LocalMode.setOffline(this, true)
    }

    private suspend fun runSpeedTest() {
        lastSpeedAt = System.currentTimeMillis()
        lastSpeed = try { withContext(Dispatchers.IO) { SpeedTest.run() } } catch (e: Exception) { lastSpeed }
    }

    private fun buildReport(): JSONObject {
        val scan = lastScan
        val bat = DeviceInfo.battery(this)
        val status = JSONObject()
            .put("agent", "stashr-hub").put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
            .put("model", DeviceInfo.model())
            .put("battery", JSONObject().put("pct", bat.opt("pct")).put("charging", bat.optBoolean("charging")))
            .put("wifi", JSONObject().put("rssi", DeviceInfo.wifiRssi(this)).put("ip", DeviceInfo.localIp()))
            .put("camera", CameraWatch.status())
            .put("voice", VoiceListener.status())
            .put("updateWaiting", Updater.waiting)
            .put("health", Health.collect(this))
        if (scan != null) {
            status.put("scan", JSONObject().put("at", System.currentTimeMillis()).put("ms", scan.ms).put("subnet", scan.subnet))
            status.put("lan", scan.toJson())
        }
        lastSpeed?.let { status.put("speed", it.toJson()) }
        val body = JSONObject().put("status", status)
        val ev = LocalMode.pendingEvents(this)
        if (ev.length() > 0) body.put("localEvents", ev)
        synchronized(acks) { if (acks.length() > 0) body.put("acks", JSONArray(acks.toString())) }
        return body
    }

    private fun ack(id: String, ok: Boolean, message: String) = synchronized(acks) { acks.put(JSONObject().put("id", id).put("ok", ok).put("message", message.take(200))) }

    /** One command from the server. Each answers with an ack on the next report. */
    private fun handle(c: JSONObject) {
        val id = c.optString("id"); val args = c.optJSONObject("args") ?: JSONObject()
        lifecycleScope.launch {
            try {
                val msg: String = when (c.optString("type")) {
                    "scan_now" -> { wake.trySend(Unit); "Scanning" }
                    "speed_test" -> { runSpeedTest(); wake.trySend(Unit); lastSpeed?.let { "${it.down} Mbit/s down, ${it.up} up" } ?: "Speed test failed" }
                    "check_update" -> Updater.check(this@HubService, manual = true)
                    "wake" -> withContext(Dispatchers.IO) { WakeOnLan.send(this@HubService, args.optString("mac")) }
                    "play_music" -> Music.play(this@HubService, args.optString("query"))
                    "camera" -> when (args.optString("action")) {
                        "arm" -> { CameraWatch.arm(); "Watching for movement" }
                        "disarm" -> { CameraWatch.disarm(); "Camera alerts off" }
                        "snapshot" -> { CameraWatch.snapshot(); "Taking a photo" }
                        "clip" -> { CameraWatch.clip(); "Recording a clip" }
                        "live" -> { CameraWatch.live(120); "Live view for 2 minutes" }
                        else -> throw IllegalArgumentException("Unknown camera action")
                    }
                    "slideshow" -> {
                        if (args.optString("action") == "stop") sendBroadcast(Intent(SlideshowActivity.ACTION_STOP).setPackage(packageName))
                        else startActivity(Intent(this@HubService, SlideshowActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        "Slideshow ${args.optString("action")}"
                    }
                    "send_whatsapp" -> com.tanush.stashr.hub.whatsapp.WhatsAppSender.send(this@HubService, args.optString("group"), args.optString("text"))
                    "announce" -> {
                        val text = args.optString("text").trim().take(200)
                        if (text.isEmpty()) throw IllegalArgumentException("Nothing to show")
                        com.tanush.stashr.hub.ui.AnnounceActivity.show(this@HubService, text, args.optBoolean("speak", true), args.optBoolean("urgent", false))
                        "Shown"
                    }
                    "show_today" -> {
                        startActivity(Intent(this@HubService, com.tanush.stashr.hub.ui.TodayActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                        "Showing today's updates"
                    }
                    else -> throw IllegalArgumentException("This app version does not know “${c.optString("type")}”")
                }
                ack(id, true, msg)
            } catch (e: Exception) { ack(id, false, e.message ?: "Failed") }
        }
    }

    companion object {
        const val CHANNEL = "hub"
        const val NOTE_ID = 1
        const val ACTION_REPORT_NOW = "com.tanush.stashr.hub.REPORT_NOW"
        @Volatile var running: HubService? = null
        @Volatile var lastReport = 0L
        @Volatile var lastError = ""

        fun start(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, HubService::class.java))
        fun reportNow(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, HubService::class.java).setAction(ACTION_REPORT_NOW))
    }
}

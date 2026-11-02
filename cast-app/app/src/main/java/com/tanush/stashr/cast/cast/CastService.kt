package com.tanush.stashr.cast.cast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import com.tanush.stashr.cast.R
import com.tanush.stashr.cast.core.Logic
import com.tanush.stashr.cast.ui.MainActivity
import java.io.IOException

/**
 * Holds the cast together: the screen capture (it must run as a foreground service, so Android shows one low-key
 * notification), the encoder, the optional sound, the connection to the TV, and the little threads around them (pings,
 * reading the TV's 'K' and 'Q', a watchdog, the numbers for the main screen). Everything stops when the connection drops,
 * the TV says 'Q', or the person taps Stop.
 */
class CastService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var pending: CastSession.Pending? = null
    private var projection: MediaProjection? = null
    private var sender: PacketSender? = null
    private var encoder: ScreenEncoder? = null
    private var audio: Any? = null            // AudioCapture (API 29+), kept untyped so older phones never load the class
    private var wifiLock: WifiManager.WifiLock? = null
    private var displayListener: DisplayManager.DisplayListener? = null
    @Volatile private var running = false
    private var lastW = 0
    private var lastH = 0
    private var lastSent = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { shutdown("", true); return START_NOT_STICKY }
        goForeground(NOTE_ID, notification(CastSession.pending?.tvName ?: "your TV"))      // Android wants this within seconds of startForegroundService
        val p = CastSession.takePending()
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)
        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        if (p == null || data == null || code == 0 || running) { p?.let { try { it.socket.close() } catch (_: Exception) { } }; if (!running) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }; return START_NOT_STICKY }
        pending = p
        try { begin(p, code, data) } catch (e: Exception) { shutdown("Could not start casting: ${e.message ?: "unknown error"}", true) }
        return START_NOT_STICKY
    }

    private fun begin(p: CastSession.Pending, code: Int, data: Intent) {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = mpm.getMediaProjection(code, data)
        projection = proj
        proj.registerCallback(object : MediaProjection.Callback() { override fun onStop() { main.post { shutdown("", false) } } }, main)

        val socket = p.socket
        val s = PacketSender(socket.getOutputStream(), p.quality.bitrate) { e -> main.post { shutdown("Lost the TV: ${e.message ?: "connection closed"}", false) } }
        sender = s
        s.start()
        running = true

        // Wi-Fi power saving is what makes casting stutter: ask for the low-latency lock while it runs.
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        wifiLock = wm.createWifiLock(if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF, "stashr-cast").apply { setReferenceCounted(false); acquire() }

        val (w, h, dpi) = screenSize()
        val (sw, sh) = Logic.scaleTo(w, h)
        lastW = w; lastH = h
        val enc = ScreenEncoder(proj, s, p.quality.bitrate, p.fps)
        encoder = enc
        enc.start(sw, sh, dpi)

        if (p.audio && Build.VERSION.SDK_INT >= 29) {
            val a = AudioCapture(proj, s)
            if (a.start()) audio = a else CastSession.note = "Sound is not sent: this phone does not allow it."
        } else if (p.audio) CastSession.note = "Sound needs Android 10 or newer; only the picture is sent."

        CastSession.tvName = p.tvName; CastSession.width = sw; CastSession.height = sh; CastSession.fps = p.fps; CastSession.bitrate = p.quality.bitrate
        CastSession.dropped = 0; CastSession.error = ""; CastSession.bytesPerSec = 0; CastSession.casting = true

        // The TV can ask for a fresh picture ('K') or end the cast ('Q').
        Thread({
            try {
                val input = socket.getInputStream()
                while (running) {
                    when (input.read()) {
                        Logic.MSG_KEY -> enc.requestKey()
                        Logic.MSG_STOP -> { main.post { shutdown("", false) }; return@Thread }
                        -1 -> { main.post { shutdown("The TV closed the connection.", false) }; return@Thread }
                    }
                }
            } catch (e: IOException) { if (running) main.post { shutdown("Lost the TV: ${e.message ?: "connection closed"}", false) } }
        }, "cast-reader").apply { isDaemon = true; start() }

        // A ping every 2 s keeps the link warm and gives the watchdog something to check; the same tick updates the numbers.
        val tick = object : Runnable {
            override fun run() {
                if (!running) return
                s.control(Logic.T_PING, System.nanoTime() / 1000, ByteArray(0))
                val now = s.sentBytes.get()
                CastSession.bytesPerSec = (now - lastSent) / 2; lastSent = now
                CastSession.dropped = s.droppedVideo.get()
                if (System.currentTimeMillis() - s.lastWriteAt > 6000) { shutdown("The TV stopped answering.", false); return }
                main.postDelayed(this, 2000)
            }
        }
        main.postDelayed(tick, 2000)

        // Rotation: a new size needs a new encoder and a new config + key frame.
        val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                if (displayId != Display.DEFAULT_DISPLAY || !running) return
                val (nw, nh, ndpi) = screenSize()
                if (nw == lastW && nh == lastH) return
                lastW = nw; lastH = nh
                val (a, b) = Logic.scaleTo(nw, nh)
                try { enc.resize(a, b, ndpi); CastSession.width = a; CastSession.height = b } catch (_: Exception) { }
            }
        }
        displayListener = l
        dm.registerDisplayListener(l, main)
    }

    /** The real screen size in pixels and its density. */
    @Suppress("DEPRECATION")
    private fun screenSize(): Triple<Int, Int, Int> {
        val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val d = dm.getDisplay(Display.DEFAULT_DISPLAY)
        val m = DisplayMetrics()
        d.getRealMetrics(m)
        return Triple(m.widthPixels, m.heightPixels, m.densityDpi)
    }

    private fun shutdown(error: String, userStopped: Boolean) {
        val wasRunning = running
        running = false
        if (error.isNotEmpty()) CastSession.error = error
        CastSession.casting = false
        CastSession.bytesPerSec = 0
        main.removeCallbacksAndMessages(null)
        try { displayListener?.let { (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).unregisterDisplayListener(it) } } catch (_: Exception) { }
        displayListener = null
        if (Build.VERSION.SDK_INT >= 29) (audio as? AudioCapture)?.stop()
        audio = null
        try { encoder?.stop() } catch (_: Exception) { }
        encoder = null
        try { sender?.control(Logic.T_PING, 0, ByteArray(0)); Thread.sleep(30) } catch (_: Exception) { }
        sender?.stop(); sender = null
        try { pending?.socket?.close() } catch (_: Exception) { }
        pending = null
        try { projection?.stop() } catch (_: Exception) { }
        projection = null
        try { wifiLock?.release() } catch (_: Exception) { }
        wifiLock = null
        if (wasRunning || userStopped || error.isNotEmpty()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }

    override fun onDestroy() { if (running) shutdown("", false); super.onDestroy() }

    private fun notification(tv: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Casting", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false); setSound(null, null); enableVibration(false) })
        val stop = PendingIntent.getService(this, 1, Intent(this, CastService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle("Casting to $tv").setContentText("Tap Stop to end")
            .setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
    }

    private fun goForeground(id: Int, n: Notification) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(id, n)
    }

    companion object {
        const val ACTION_STOP = "com.tanush.stashr.cast.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL = "cast"
        private const val NOTE_ID = 1

        fun start(ctx: Context, code: Int, data: Intent) {
            ctx.startForegroundService(Intent(ctx, CastService::class.java).putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data))
        }
        fun stop(ctx: Context) { ctx.startService(Intent(ctx, CastService::class.java).setAction(ACTION_STOP)) }
    }
}

package com.tanush.stashr.hub.phone

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.tanush.stashr.hub.R
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Prefs
import org.json.JSONObject
import kotlin.concurrent.thread

/** One position fix, as the server wants it: { lat, lon, acc (meters), at (epoch ms) }. */
data class Fix(val lat: Double, val lon: Double, val acc: Int, val at: Long) {
    fun toJson(): JSONObject = JSONObject().put("lat", lat).put("lon", lon).put("acc", acc).put("at", at)
}

/**
 * Shares this phone's position with your own Stashr server, only while the switch on the phone screen is on. Uses the
 * system location manager (no Google services). A fix is sent at most every 45 seconds, or at once after moving 100 m.
 */
class LocationService : Service() {
    private var lm: LocationManager? = null
    private var lastSent: Fix? = null
    private var lastSentAt = 0L
    private val listener = object : LocationListener {
        override fun onLocationChanged(l: Location) { onFix(l) }
        @Deprecated("old callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("location", "Location sharing", NotificationManager.IMPORTANCE_MIN))
        val n = Notification.Builder(this, "location").setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Sharing your location with Stashr").setOngoing(true).build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(3, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(3, n)
        } catch (e: Exception) { stopSelf(); return START_NOT_STICKY }
        if (!Prefs(this).shareLocation || !hasPermission(this)) { stopSelf(); return START_NOT_STICKY }
        listen()
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun listen() {
        val m = getSystemService(LocationManager::class.java) ?: return
        lm = m
        for (p in listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)) {
            try { if (m.isProviderEnabled(p)) m.requestLocationUpdates(p, 60_000L, 50f, listener, mainLooper) } catch (e: Exception) { /* provider unavailable */ }
        }
        try { m.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)?.let { if (System.currentTimeMillis() - it.time < 10 * 60_000) onFix(it) } } catch (e: Exception) { }
    }

    private fun onFix(l: Location) {
        val fix = Fix(l.latitude, l.longitude, l.accuracy.toInt(), System.currentTimeMillis())
        last = fix
        val now = fix.at
        val moved = lastSent?.let { FloatArray(1).also { r -> Location.distanceBetween(it.lat, it.lon, fix.lat, fix.lon, r) }[0] } ?: Float.MAX_VALUE
        if (now - lastSentAt < 45_000 && moved <= 100f) return
        lastSentAt = now; lastSent = fix
        val app = applicationContext
        thread {
            try { Api(app).report(JSONObject().put("status", PhoneReporter.status(app))) } catch (e: Exception) { /* next fix retries */ }
        }
    }

    override fun onDestroy() { try { lm?.removeUpdates(listener) } catch (e: Exception) { }; super.onDestroy() }

    companion object {
        @Volatile var last: Fix? = null
        fun hasPermission(c: Context) = ContextCompat.checkSelfPermission(c, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(c, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        fun hasBackground(c: Context) = Build.VERSION.SDK_INT < 29 ||
            ContextCompat.checkSelfPermission(c, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        fun start(c: Context) = ContextCompat.startForegroundService(c, Intent(c, LocationService::class.java))
        fun stop(c: Context) { c.stopService(Intent(c, LocationService::class.java)) }
    }
}

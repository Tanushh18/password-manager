package com.tanush.stashr.hub.phone

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Looper
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Prefs
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.coroutines.resume

/**
 * Battery-saver location sharing, with no notification: passive updates (free: they ride on fixes other apps ask for,
 * delivered to [LocationReceiver] even when this app is closed) plus one quick network fix every 15 minutes. A fix goes
 * to the server only after moving more than 150 m, or when 14 minutes have passed. "Precise mode" (a foreground
 * service, see [LocationService]) is a separate, optional switch.
 */
object LocationShare {
    private const val WORK = "stashr-location"
    private const val REQ = 31
    private const val MOVE_M = 150f
    private const val EVERY_MS = 14 * 60_000L

    private fun prefs(c: Context) = c.getSharedPreferences("locshare", Context.MODE_PRIVATE)

    fun lastFix(c: Context): Fix? = try {
        val j = JSONObject(prefs(c).getString("fix", null) ?: return null)
        Fix(j.getDouble("lat"), j.getDouble("lon"), j.optInt("acc"), j.getLong("at"), j.optDouble("speed", -1.0).toFloat())
    } catch (e: Exception) { null }

    /** Remembers a fix (also for a later process) and shows it on the phone screen. */
    fun record(c: Context, fix: Fix) {
        prefs(c).edit().putString("fix", fix.toJson().toString()).apply()
        LocationService.last = fix
    }

    private fun pending(c: Context): PendingIntent {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(c, REQ, Intent(c, LocationReceiver::class.java), flags)
    }

    @SuppressLint("MissingPermission")
    fun start(ctx: Context) {
        val c = ctx.applicationContext
        val p = Prefs(c)
        if (!p.paired || p.role == "hub" || !p.shareLocation || !LocationService.hasPermission(c)) return
        try { c.getSystemService(LocationManager::class.java)?.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 0L, 0f, pending(c)) } catch (e: Exception) { /* no passive provider */ }
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<LocationWorker>(15, TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        if (p.preciseLocation) LocationService.start(c) else LocationService.stop(c)
    }

    fun stop(ctx: Context) {
        val c = ctx.applicationContext
        try { c.getSystemService(LocationManager::class.java)?.removeUpdates(pending(c)) } catch (e: Exception) { }
        WorkManager.getInstance(c).cancelUniqueWork(WORK)
        LocationService.stop(c)
    }

    /** A new fix from the passive receiver or the 15-minute job: send it when it matters. */
    fun onFix(c: Context, l: Location) {
        val fix = Fix(l.latitude, l.longitude, l.accuracy.toInt(), System.currentTimeMillis(), if (l.hasSpeed()) l.speed else -1f)
        val pr = prefs(c)
        val sentLat = pr.getFloat("sentLat", 999f).toDouble(); val sentLon = pr.getFloat("sentLon", 999f).toDouble(); val sentAt = pr.getLong("sentAt", 0L)
        record(c, fix)
        val moved = if (sentAt == 0L) Float.MAX_VALUE else FloatArray(1).also { r -> Location.distanceBetween(sentLat, sentLon, fix.lat, fix.lon, r) }[0]
        if (moved <= MOVE_M && fix.at - sentAt < EVERY_MS) return
        pr.edit().putFloat("sentLat", fix.lat.toFloat()).putFloat("sentLon", fix.lon.toFloat()).putLong("sentAt", fix.at).apply()
        val app = c.applicationContext
        thread { try { Api(app).report(JSONObject().put("status", PhoneReporter.status(app))) } catch (e: Exception) { /* the next fix retries */ } }
    }

    /** One quick fix: the network provider first (cheap), then the last known position. */
    @Suppress("DEPRECATION")
    @SuppressLint("MissingPermission")
    suspend fun oneFix(c: Context): Location? {
        val lm = c.getSystemService(LocationManager::class.java) ?: return null
        val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).firstOrNull { try { lm.isProviderEnabled(it) } catch (e: Exception) { false } } ?: return null
        val fresh = withTimeoutOrNull(20_000L) {
            suspendCancellableCoroutine<Location?> { cont ->
                if (Build.VERSION.SDK_INT >= 30) {
                    val cancel = CancellationSignal()
                    cont.invokeOnCancellation { cancel.cancel() }
                    lm.getCurrentLocation(provider, cancel, c.mainExecutor) { if (cont.isActive) cont.resume(it) }
                } else {
                    val l = object : LocationListener {
                        override fun onLocationChanged(loc: Location) { if (cont.isActive) cont.resume(loc) }
                        @Deprecated("old callback") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
                        override fun onProviderEnabled(p: String) {}
                        override fun onProviderDisabled(p: String) {}
                    }
                    cont.invokeOnCancellation { lm.removeUpdates(l) }
                    lm.requestSingleUpdate(provider, l, Looper.getMainLooper())
                }
            }
        }
        if (fresh != null) return fresh
        return try { lm.getLastKnownLocation(provider)?.takeIf { System.currentTimeMillis() - it.time < 30 * 60_000L } } catch (e: Exception) { null }
    }
}

/** Receives the system's passive location updates (also when the app is not running). */
class LocationReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION")
    override fun onReceive(ctx: Context, intent: Intent) {
        val p = Prefs(ctx)
        if (!p.paired || !p.shareLocation) return
        val list = intent.getParcelableArrayListExtra<Location>(LocationManager.KEY_LOCATIONS)
        val one = intent.getParcelableExtra<Location>(LocationManager.KEY_LOCATION_CHANGED)
        val l = list?.lastOrNull() ?: one ?: return
        LocationShare.onFix(ctx.applicationContext, l)
    }
}

/** Every 15 minutes: one quick fix, unless a fresh one already arrived. */
class LocationWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = applicationContext
        val p = Prefs(c)
        if (!p.paired || !p.shareLocation || !LocationService.hasPermission(c)) return Result.success()
        val last = LocationShare.lastFix(c)
        if (last != null && System.currentTimeMillis() - last.at < 10 * 60_000L) return Result.success()
        LocationShare.oneFix(c)?.let { LocationShare.onFix(c, it) }
        return Result.success()
    }
}

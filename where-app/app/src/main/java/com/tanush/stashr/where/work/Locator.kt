package com.tanush.stashr.where.work

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.Executors
import kotlin.coroutines.resume

/** One position fix. speed is in m/s, or null when the phone does not know it. */
data class Fix(val lat: Double, val lon: Double, val acc: Float, val at: Long, val speed: Float?)

/**
 * Takes ONE fix and stops: the network provider first (cheap), GPS only when the network fix is missing or worse than
 * 300 m. Nothing stays on between checks.
 */
object Locator {
    fun hasPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun toFix(l: Location) = Fix(l.latitude, l.longitude, if (l.hasAccuracy()) l.accuracy else 0f, if (l.time > 0) l.time else System.currentTimeMillis(), if (l.hasSpeed()) l.speed else null)

    @SuppressLint("MissingPermission")
    suspend fun one(ctx: Context, live: Boolean = false): Fix? {
        if (!hasPermission(ctx)) return null
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        return try {
            var best: Location? = null
            val timeout = if (live) 15_000L else 20_000L
            if (safeEnabled(lm, LocationManager.NETWORK_PROVIDER)) best = fresh(lm, LocationManager.NETWORK_PROVIDER, timeout, live)
            // Live mode wants a fix that is good enough to draw on a map: GPS when the network fix is worse than 100 m.
            if ((best == null || (best.hasAccuracy() && best.accuracy > (if (live) 100f else 300f))) && safeEnabled(lm, LocationManager.GPS_PROVIDER)) {
                val gps = fresh(lm, LocationManager.GPS_PROVIDER, timeout, live)
                if (gps != null) best = gps
            }
            best?.let { toFix(it) }
        } catch (e: SecurityException) { null } catch (e: Exception) { null }
    }

    private fun safeEnabled(lm: LocationManager, provider: String) = try { lm.isProviderEnabled(provider) } catch (e: Exception) { false }

    @SuppressLint("MissingPermission")
    private suspend fun fresh(lm: LocationManager, provider: String, timeoutMs: Long = 20_000, live: Boolean = false): Location? {
        if (Build.VERSION.SDK_INT >= 30) {
            val exec = Executors.newSingleThreadExecutor()
            try {
                return withTimeoutOrNull(timeoutMs) {
                    suspendCancellableCoroutine<Location?> { cont ->
                        val signal = android.os.CancellationSignal()
                        cont.invokeOnCancellation { signal.cancel() }
                        lm.getCurrentLocation(provider, signal, exec) { loc -> if (cont.isActive) cont.resume(loc) }
                    }
                }
            } finally { exec.shutdown() }
        }
        val last = lm.getLastKnownLocation(provider)
        // Live mode never reuses an old position.
        if (!live && last != null && System.currentTimeMillis() - last.time < 5 * 60_000) return last
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<Location?> { cont ->
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, { loc -> if (cont.isActive) cont.resume(loc) }, Looper.getMainLooper())
            }
        } ?: (if (live) null else last)
    }
}

package com.tanush.stashr.where.work

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import com.tanush.stashr.where.core.Api
import com.tanush.stashr.where.core.ApiError
import com.tanush.stashr.where.core.Logic
import com.tanush.stashr.where.core.Prefs
import org.json.JSONObject
import java.io.IOException
import java.net.Inet4Address

/** Takes a fix (or uses the one it is given), sends it, remembers the answer, shows notices, schedules the next check. */
object Reporter {
    sealed class Result {
        data class Sent(val text: String) : Result()
        data class Failed(val message: String) : Result()
        object NoFix : Result()
        object Unlinked : Result()
    }

    suspend fun run(ctx: Context, given: Fix? = null, live: Boolean = false): Result {
        val app = ctx.applicationContext
        val prefs = Prefs(app)
        if (!prefs.linked) return Result.Unlinked
        val fix = given ?: Locator.one(app, live || prefs.live)
        if (fix == null) {
            prefs.lastError = if (Locator.hasPermission(app)) "Could not get a location fix" else "Location is not allowed"
            Scheduler.next(app, prefs.lastDelaySec, prefs.live)
            return Result.NoFix
        }
        prefs.fixLat = fix.lat; prefs.fixLon = fix.lon; prefs.fixAcc = fix.acc; prefs.fixAt = fix.at; prefs.fixSpeed = fix.speed ?: -1f
        return try {
            val answer = Logic.parseAnswer(Api(app).location(body(app, fix)))
            prefs.upLat = fix.lat; prefs.upLon = fix.lon; prefs.upAt = System.currentTimeMillis()
            prefs.state = answer.state; prefs.distanceKm = answer.distanceKm?.toFloat() ?: -1f; prefs.etaMinutes = answer.etaMinutes ?: -1
            prefs.lastError = ""
            prefs.live = answer.live
            val delay = Logic.clampDelay(answer.nextCheckSec, answer.live)
            prefs.lastDelaySec = delay
            Notices.show(app, answer.notices)
            Scheduler.next(app, delay, answer.live)
            Result.Sent(Logic.statusText(answer.state, answer.distanceKm, answer.etaMinutes))
        } catch (e: ApiError) {
            if (e.status == 401) { disconnect(app, "Stashr disconnected this phone. Link it again with a new code."); Result.Unlinked }
            else { prefs.live = false; prefs.lastError = e.message ?: "Server error"; Scheduler.next(app, 300); Result.Failed(prefs.lastError) }
        } catch (e: IOException) {
            prefs.lastError = "No connection to Stashr; will try again soon"
            val wasLive = prefs.live
            prefs.live = false
            Scheduler.next(app, if (wasLive) 10 else 300, wasLive)
            Result.Failed(prefs.lastError)
        }
    }

    /** Forgets the link and stops all work. */
    fun disconnect(ctx: Context, message: String) {
        val prefs = Prefs(ctx)
        prefs.unlink()
        prefs.message = message
        Scheduler.stop(ctx)
    }

    private fun body(ctx: Context, fix: Fix): JSONObject {
        val bat = ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = bat?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = bat?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = bat?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val (wifi, ip) = wifi(ctx)
        val json = JSONObject().put("lat", fix.lat).put("lon", fix.lon).put("acc", fix.acc.toDouble()).put("at", fix.at)
        if (fix.speed != null) json.put("speed", fix.speed.toDouble())
        json.put("battery", JSONObject().put("pct", if (level >= 0 && scale > 0) level * 100 / scale else JSONObject.NULL).put("charging", charging))
        json.put("wifi", JSONObject().put("connected", wifi).put("ip", ip))
        return json
    }

    /** (connected to Wi-Fi, the phone's own IPv4 on it). No extra permission needed. */
    private fun wifi(ctx: Context): Pair<Boolean, String> {
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val net = cm.activeNetwork ?: return false to ""
            val caps = cm.getNetworkCapabilities(net) ?: return false to ""
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return false to ""
            val ip = cm.getLinkProperties(net)?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress ?: ""
            true to ip
        } catch (e: Exception) { false to "" }
    }
}

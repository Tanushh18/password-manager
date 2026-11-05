package com.tanush.stashr.where.work

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.tanush.stashr.where.core.Logic
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.update.Updater
import java.util.concurrent.TimeUnit

/**
 * No foreground service and no notification: one check is scheduled at a time, with the delay the server asks for
 * (short when someone is heading home, long when far away or at home), plus a 15-minute safety net and the free
 * passive location source.
 */
object Scheduler {
    private const val NEXT = "where-next"
    private const val PERIODIC = "where-periodic"
    private const val PASSIVE_WORK = "where-passive"
    private const val LIVE_NOW = "where-live-now"
    private const val WIFI_CHANGED = "where-wifi-changed"
    private const val PUSHED = "where-pushed"

    fun start(ctx: Context) {
        val app = ctx.applicationContext
        if (!Prefs(app).linked) return
        val wm = WorkManager.getInstance(app)
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<LocationWorker>(15, TimeUnit.MINUTES).build())
        if (wm.getWorkInfosForUniqueWork(NEXT).get().none { !it.state.isFinished }) next(app, 60)
        registerPassive(app)
        registerWifi(app)
        fetchPushToken(app)
    }

    /** Asks Firebase for this phone's push address and keeps it; it goes to Stashr with the next report. A failure only means no push yet. */
    fun fetchPushToken(ctx: Context) {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { t ->
                if (!t.isNullOrEmpty()) Prefs(ctx.applicationContext).fcmToken = t
            }
        } catch (e: Exception) { /* Firebase not available: the timed checks still run */ }
    }

    /** The server's push arrived ("locate" when this phone went quiet, "now" for Refresh location): report soon. */
    fun pushed(ctx: Context, force: Boolean) {
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInputData(workDataOf("push" to true, "force" to force))
            .setConstraints(Constraints.Builder().build()).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(PUSHED, if (force) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, req)
    }

    /**
     * The next check. live = a family TV is showing the live map: 5 to 30 seconds, the check takes a fresh fix and a second,
     * slightly later trigger (AlarmManager.setAndAllowWhileIdle, no permission needed) covers a delayed WorkManager job.
     * Back to a normal long delay, the alarm is cancelled.
     */
    fun next(ctx: Context, delaySec: Int, live: Boolean = false) {
        val app = ctx.applicationContext
        val d = Logic.clampDelay(delaySec, live)
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInitialDelay(d.toLong(), TimeUnit.SECONDS)
            .setInputData(workDataOf("live" to live))
            .setConstraints(Constraints.Builder().build()).build()
        WorkManager.getInstance(app).enqueueUniqueWork(NEXT, ExistingWorkPolicy.REPLACE, req)
        if (live) armAlarm(app, d + 4) else cancelAlarm(app)
    }

    private fun alarmIntent(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, 9, Intent(ctx, LiveAlarmReceiver::class.java).setPackage(ctx.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun armAlarm(ctx: Context, afterSec: Int) {
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + afterSec * 1000L, alarmIntent(ctx))
        } catch (e: Exception) { /* the WorkManager job still runs */ }
    }

    fun cancelAlarm(ctx: Context) {
        try { (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarmIntent(ctx)) } catch (e: Exception) { }
    }

    /** The backup alarm fired: run the live check now (the worker skips it when the scheduled one already ran). */
    fun liveNow(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInputData(workDataOf("live" to true))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(LIVE_NOW, ExistingWorkPolicy.KEEP, req)
    }

    /** A fix that arrived through the passive provider: upload it soon (the worker checks the 300 m / 2 minute rule). */
    fun uploadPassive(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInputData(workDataOf("passive" to true))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(PASSIVE_WORK, ExistingWorkPolicy.KEEP, req)
    }

    fun stop(ctx: Context) {
        val app = ctx.applicationContext
        val wm = WorkManager.getInstance(app)
        wm.cancelUniqueWork(NEXT); wm.cancelUniqueWork(PERIODIC); wm.cancelUniqueWork(PASSIVE_WORK); wm.cancelUniqueWork(LIVE_NOW)
        cancelAlarm(app)
        unregisterPassive(app)
        unregisterWifi(app)
        wm.cancelUniqueWork(WIFI_CHANGED)
        wm.cancelUniqueWork(PUSHED)
    }

    private fun wifiIntent(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, 11, Intent(ctx, NetworkReceiver::class.java).setPackage(ctx.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)

    /**
     * Wi-Fi coming or going wakes the app (no service, no battery cost while nothing changes): leaving home drops the home Wi-Fi, so the
     * server hears about it within seconds instead of at the next 5 to 30 minute check, and arriving home is noticed the same way.
     */
    fun registerWifi(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), wifiIntent(ctx))
        } catch (e: Exception) { /* the timed checks still run */ }
    }

    private fun unregisterWifi(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        try { (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(wifiIntent(ctx)) } catch (e: Exception) { }
    }

    /** The Wi-Fi changed: a real check in a few seconds (the worker drops it when the battery is low or one just went out). */
    fun wifiChanged(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInitialDelay(5, TimeUnit.SECONDS).setInputData(workDataOf("wifi" to true))
            .setConstraints(Constraints.Builder().build()).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(WIFI_CHANGED, ExistingWorkPolicy.REPLACE, req)
    }

    private fun passiveIntent(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, 7, Intent(ctx, PassiveReceiver::class.java).setPackage(ctx.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)

    @SuppressLint("MissingPermission")
    fun registerPassive(ctx: Context) {
        if (!Locator.hasPermission(ctx)) return
        try {
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 0L, 0f, passiveIntent(ctx))
        } catch (e: Exception) { /* optional extra source */ }
    }

    private fun unregisterPassive(ctx: Context) {
        try { (ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(passiveIntent(ctx)) } catch (e: Exception) { }
    }
}

/** The scheduled check, the safety net and the passive-fix upload all run this. */
class LocationWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        if (!prefs.linked) return Result.success()
        if (inputData.getBoolean("passive", false)) {
            val moved = if (prefs.upAt > 0) Logic.distanceM(prefs.upLat, prefs.upLon, prefs.pendingLat, prefs.pendingLon) else null
            if (prefs.pendingAt > 0 && Logic.passiveWorthUploading(moved, System.currentTimeMillis() - prefs.upAt)) {
                Reporter.run(applicationContext, Fix(prefs.pendingLat, prefs.pendingLon, prefs.pendingAcc, prefs.pendingAt, prefs.pendingSpeed.takeIf { it >= 0 }))
            }
            return Result.success()
        }
        if (inputData.getBoolean("push", false)) {
            val force = inputData.getBoolean("force", false)
            if (Logic.pushWorthIt(System.currentTimeMillis() - prefs.callAt, force)) Reporter.run(applicationContext, force = force)
            return Result.success()
        }
        if (inputData.getBoolean("wifi", false)) {
            val (pct, charging) = Reporter.battery(applicationContext)
            if (Logic.wifiTriggerWorthIt(pct, charging, System.currentTimeMillis() - prefs.upAt)) Reporter.run(applicationContext, force = true)
            return Result.success()
        }
        if (inputData.getBoolean("live", false)) {
            // Live mode: a fresh fix and an upload at once. The scheduled job and the backup alarm may both fire; one is enough.
            if (System.currentTimeMillis() - prefs.upAt < 3_000) return Result.success()
            Reporter.run(applicationContext, live = true)
            return Result.success()
        }
        // The safety net must not double an upload the scheduled check just made.
        if (System.currentTimeMillis() - prefs.upAt < 60_000) return Result.success()
        Reporter.run(applicationContext)
        if (System.currentTimeMillis() - prefs.updateCheckedAt > 24 * 3600_000L) Updater.check(applicationContext)
        return Result.success()
    }
}

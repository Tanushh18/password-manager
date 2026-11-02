package com.tanush.stashr.where.work

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.LocationManager
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

    fun start(ctx: Context) {
        val app = ctx.applicationContext
        if (!Prefs(app).linked) return
        val wm = WorkManager.getInstance(app)
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<LocationWorker>(15, TimeUnit.MINUTES).build())
        if (wm.getWorkInfosForUniqueWork(NEXT).get().none { !it.state.isFinished }) next(app, 60)
        registerPassive(app)
    }

    fun next(ctx: Context, delaySec: Int) {
        val d = Logic.clampDelay(delaySec)
        val req = OneTimeWorkRequestBuilder<LocationWorker>().setInitialDelay(d.toLong(), TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().build()).build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(NEXT, ExistingWorkPolicy.REPLACE, req)
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
        wm.cancelUniqueWork(NEXT); wm.cancelUniqueWork(PERIODIC); wm.cancelUniqueWork(PASSIVE_WORK)
        unregisterPassive(app)
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
        // The safety net must not double an upload the scheduled check just made.
        if (System.currentTimeMillis() - prefs.upAt < 60_000) return Result.success()
        Reporter.run(applicationContext)
        if (System.currentTimeMillis() - prefs.updateCheckedAt > 24 * 3600_000L) Updater.check(applicationContext)
        return Result.success()
    }
}

package com.tanush.stashr.where.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.os.Build
import com.tanush.stashr.where.core.Prefs

/** Free fixes other apps asked for: saved, and handed to the worker (which decides whether they are worth sending). */
class PassiveReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val prefs = Prefs(ctx)
        if (!prefs.linked) return
        val loc: Location? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(LocationManager.KEY_LOCATION_CHANGED, Location::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra(LocationManager.KEY_LOCATION_CHANGED)
        if (loc == null) return
        val f = Locator.toFix(loc)
        prefs.pendingLat = f.lat; prefs.pendingLon = f.lon; prefs.pendingAcc = f.acc; prefs.pendingAt = f.at; prefs.pendingSpeed = f.speed ?: -1f
        Scheduler.uploadPassive(ctx)
    }
}

package com.tanush.stashr.where.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tanush.stashr.where.core.Prefs

/** The phone joined or left a Wi-Fi network: ask for a fresh location soon (see [Scheduler.registerWifi]). */
class NetworkReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!Prefs(ctx).linked) return
        Scheduler.wifiChanged(ctx)
    }
}

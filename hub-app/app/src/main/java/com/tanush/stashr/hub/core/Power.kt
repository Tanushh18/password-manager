package com.tanush.stashr.hub.core

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/** Power saving for the home tablet. Always on (plugged in or not) unless the switch on the dashboard is turned off. */
object Power {
    fun charging(ctx: Context): Boolean {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return true
        val st = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL || i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    }

    fun percent(ctx: Context): Int {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return 100
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1); val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        return if (level >= 0 && scale > 0) level * 100 / scale else 100
    }

    /** Power saving is on (the default). It no longer depends on the charger. */
    fun saving(ctx: Context) = Prefs(ctx).batterySaver

    /** How often the whole Wi-Fi is swept: every 3 minutes, every 5 when running on a battery at 20% or less. */
    fun scanEveryMs(ctx: Context): Long = when {
        !saving(ctx) -> 0L
        !charging(ctx) && percent(ctx) <= 20 -> 5 * 60_000L
        else -> 3 * 60_000L
    }
}

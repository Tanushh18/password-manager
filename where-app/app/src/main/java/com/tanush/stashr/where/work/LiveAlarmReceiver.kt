package com.tanush.stashr.where.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tanush.stashr.where.core.Prefs

/** The backup trigger for live mode: only does something while the last answer said a TV is showing the live map. */
class LiveAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!Prefs(context).linked || !Prefs(context).live) return
        Scheduler.liveNow(context)
    }
}

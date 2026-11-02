package com.tanush.stashr.where.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an update the schedule is set up again; a linked phone stays linked. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { Scheduler.start(ctx) }
}

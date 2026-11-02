package com.tanush.stashr.hub.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tanush.stashr.hub.phone.PhoneReporter

/** After a restart or an update, the tablet goes back to work and a phone's reports are scheduled again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val prefs = Prefs(ctx)
        if (!prefs.paired) return
        try {
            if (prefs.role == "hub") HubService.start(ctx) else PhoneReporter.schedule(ctx)
        } catch (e: Exception) { /* Android may refuse a start from the background; the app starts it when opened */ }
    }
}

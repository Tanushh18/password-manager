package com.tanush.stashr.where.work

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tanush.stashr.where.core.Prefs

/**
 * The Stashr server's only message: { type: "locate" | "now" }. It carries no location and no personal data; it just wakes this app
 * so it reports where the phone is (the same report as a timed check). "now" is the Refresh location button on the website.
 */
class FcmService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (!Prefs(applicationContext).linked) return
        val type = message.data["type"] ?: return
        if (type == "locate" || type == "now") Scheduler.pushed(applicationContext, force = type == "now")
    }

    /** Firebase gave this phone a new push address: keep it and let Stashr know soon (it travels with the next report). */
    override fun onNewToken(token: String) {
        val prefs = Prefs(applicationContext)
        prefs.fcmToken = token
        if (prefs.linked) Scheduler.next(applicationContext, 10)
    }
}

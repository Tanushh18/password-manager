package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.tanush.stashr.hub.core.HubService
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.phone.PhoneReporter

/** Opens the right screen: pairing, the tablet dashboard, or the phone screen. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val next = when {
            !prefs.paired -> SetupActivity::class.java
            prefs.role == "hub" -> { HubService.start(this); DashboardActivity::class.java }
            else -> { PhoneReporter.schedule(this); PhoneActivity::class.java }
        }
        startActivity(Intent(this, next).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }
}

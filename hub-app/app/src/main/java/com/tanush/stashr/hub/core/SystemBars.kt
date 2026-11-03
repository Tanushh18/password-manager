package com.tanush.stashr.hub.core

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController

/**
 * Hides or shows the system bars: the status bar on top (battery, clock, Wi-Fi) and the navigation bar at the bottom (Back, Home, Recents).
 * A swipe from the edge brings them back for a moment, then they hide again, so nothing is pressed by accident.
 */
object SystemBars {
    @Suppress("DEPRECATION")
    fun apply(a: Activity, hide: Boolean) {
        val w = a.window
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(!hide)
            w.insetsController?.let {
                if (hide) { it.hide(WindowInsets.Type.systemBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE }
                else it.show(WindowInsets.Type.systemBars())
            }
        } else {
            w.decorView.systemUiVisibility = if (hide) View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE else View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
}

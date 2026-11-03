package com.tanush.stashr.hub.core

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController

/** Hides or shows the status bar (battery, clock, Wi-Fi). A swipe from the top brings it back for a moment, then it hides again. */
object SystemBars {
    @Suppress("DEPRECATION")
    fun apply(a: Activity, hide: Boolean) {
        val w = a.window
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(!hide)
            w.insetsController?.let {
                if (hide) { it.hide(WindowInsets.Type.statusBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE }
                else it.show(WindowInsets.Type.statusBars())
            }
        } else {
            w.decorView.systemUiVisibility = if (hide) View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE else View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
}

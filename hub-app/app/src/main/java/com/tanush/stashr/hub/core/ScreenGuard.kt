package com.tanush.stashr.hub.core

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import com.tanush.stashr.hub.whatsapp.WhatsAppAccessibility

/**
 * Keeps the tablet dark. Something that wakes the screen (a WhatsApp message, an announcement) first asks [wasOff]; when
 * the work is done [restore] puts the screen back to sleep, but only if it was off before, so it never locks a tablet
 * somebody is using. Locking goes through Stashr Hub's Accessibility service (Android 9 and newer); the tablet's lock
 * screen should be None or Swipe, so waking it for the next job needs no PIN.
 */
object ScreenGuard {
    private val main = Handler(Looper.getMainLooper())

    fun wasOff(ctx: Context): Boolean = !(ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive

    /** Puts the screen to sleep now (the website's "Turn screen off" button, Telegram /screenoff). Returns what to tell the person. */
    fun lockNow(): String {
        if (Build.VERSION.SDK_INT < 28) throw IllegalStateException("This tablet's Android is too old to lock the screen from Stashr Hub")
        val service = WhatsAppAccessibility.instance ?: throw IllegalStateException("Turn on Stashr Hub in Accessibility settings first")
        if (!service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)) throw IllegalStateException("Android did not lock the screen")
        return "Screen is off"
    }

    fun restore(ctx: Context, wasOff: Boolean, delayMs: Long = 1_500L) {
        if (!wasOff || Build.VERSION.SDK_INT < 28 || !Prefs(ctx).screenOffAfter) return
        main.postDelayed({ WhatsAppAccessibility.instance?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) }, delayMs)
    }
}

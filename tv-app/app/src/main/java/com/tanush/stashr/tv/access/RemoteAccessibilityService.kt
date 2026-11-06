package com.tanush.stashr.tv.access

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Lets Stashr press Home / Back on the TV and learn which app is open. It reads no screen content
 * (canRetrieveWindowContent is off): only the package name of the window that just came forward.
 */
class RemoteAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { if (instance === this) instance = null; return super.onUnbind(intent) }
    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == "android" || pkg == "com.android.systemui" || pkg.contains("inputmethod") || pkg.contains("keyboard")) return
        val label = try { val pm = packageManager; pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() } catch (x: Exception) { pkg }
        foreground = pkg to label
    }

    companion object {
        @Volatile var instance: RemoteAccessibilityService? = null
        /** (package, label) of the app that came forward last, or null. */
        @Volatile var foreground: Pair<String, String>? = null

        fun enabled(ctx: Context): Boolean {
            val want = ctx.packageName + "/" + RemoteAccessibilityService::class.java.name
            val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return list.split(':').any { it.equals(want, true) || it.equals(ctx.packageName + "/" + RemoteAccessibilityService::class.java.name.removePrefix(ctx.packageName), true) }
        }

        fun home(): Boolean = instance?.performGlobalAction(GLOBAL_ACTION_HOME) ?: false
        fun back(): Boolean = instance?.performGlobalAction(GLOBAL_ACTION_BACK) ?: false
    }
}

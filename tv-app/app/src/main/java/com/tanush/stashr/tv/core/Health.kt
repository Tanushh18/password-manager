package com.tanush.stashr.tv.core

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.tanush.stashr.tv.BuildConfig
import com.tanush.stashr.tv.access.RemoteAccessibilityService
import com.tanush.stashr.tv.sync.MovieStore
import org.json.JSONObject

/** The last thing that went wrong on this TV, kept for 7 days and sent with every status so the website can show it. */
data class HealthError(val at: Long, val where: String, val text: String)

/** What the website's "Health check" needs to know about this TV. A value that could not be found out is left out, never guessed. */
object Health {
    const val KEEP_MS = 7 * 24 * 3600_000L
    const val MAX_TEXT = 300

    /** Pure: the `health` object of a status. Booleans that are null are omitted; an error older than 7 days is dropped. */
    fun build(
        appVersion: String, versionCode: Int, sdk: Int, model: String,
        overlay: Boolean?, accessibility: Boolean?, batteryUnrestricted: Boolean?, notifications: Boolean?, usbStorage: Boolean?,
        lastError: HealthError?, now: Long
    ): JSONObject {
        val o = JSONObject().put("appVersion", appVersion).put("versionCode", versionCode).put("sdk", sdk).put("model", model.take(60))
        overlay?.let { o.put("overlay", it) }
        accessibility?.let { o.put("accessibility", it) }
        batteryUnrestricted?.let { o.put("batteryUnrestricted", it) }
        notifications?.let { o.put("notifications", it) }
        usbStorage?.let { o.put("usbStorage", it) }
        val e = lastError?.takeIf { now - it.at in 0..KEEP_MS }
        o.put("lastError", if (e == null) JSONObject.NULL else JSONObject().put("at", e.at).put("where", e.where.take(20)).put("text", e.text.take(MAX_TEXT)))
        return o
    }

    /** "java.lang.IllegalStateException: boom at Foo.bar(Foo.kt:12) at …" with the first 3 frames. */
    fun describe(t: Throwable): String = (t.javaClass.name + (t.message?.let { ": $it" } ?: "") +
        t.stackTrace.take(3).joinToString("") { " at ${it.className.substringAfterLast('.')}.${it.methodName}(${it.fileName}:${it.lineNumber})" }).take(MAX_TEXT)

    @Volatile private var app: Context? = null

    /** Called once from the Application: keeps the crash handler and the context for later non-fatal notes. */
    fun install(application: Application) {
        app = application.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try { Prefs(application).setHealthError(HealthError(System.currentTimeMillis(), "crash", describe(error))) } catch (e: Exception) { /* nothing more to do */ }
            previous?.uncaughtException(thread, error)
        }
    }

    /** A failure worth knowing about that did not crash the app (where: report | cast | sync). */
    fun record(where: String, text: String) {
        val c = app ?: return
        try { Prefs(c).setHealthError(HealthError(System.currentTimeMillis(), where, text.take(MAX_TEXT))) } catch (e: Exception) { /* ignore */ }
    }

    /** The real thing, read from this TV. */
    fun collect(ctx: Context): JSONObject {
        fun <T> known(f: () -> T): T? = try { f() } catch (e: Exception) { null }
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return build(
            BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT, (Build.MANUFACTURER + " " + Build.MODEL).trim(),
            known { Settings.canDrawOverlays(ctx) }, known { RemoteAccessibilityService.enabled(ctx) },
            known { pm?.isIgnoringBatteryOptimizations(ctx.packageName) }, known { NotificationManagerCompat.from(ctx).areNotificationsEnabled() },
            known { MovieStore.onUsb(ctx) }, Prefs(ctx).healthError(), System.currentTimeMillis()
        )
    }
}

/** Starts the crash handler as early as possible (before any screen or service). */
class StashrTvApp : Application() {
    override fun onCreate() { super.onCreate(); Health.install(this) }
}

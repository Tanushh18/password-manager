package com.tanush.stashr.hub.core

import android.Manifest
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The pure parts of the health report (no Android types, unit-tested): the last error and how long it is kept,
 * the "3 failures in a row" rule, the JSON the website reads (see server/utils/home.js cleanHealth) and the lines of the
 * "Check" card. The website's Health tab words the same fixes (client/src/lib/smartHome.js healthItems).
 */
object HealthLogic {
    const val KEEP_MS = 7L * 24 * 3600 * 1000
    const val MAX_TEXT = 300

    data class LastError(val at: Long, val where: String, val text: String)
    data class Problem(val id: String, val label: String, val fix: String, val red: Boolean)

    fun clip(s: String, max: Int = MAX_TEXT): String = s.replace(Regex("[\\u0000-\\u001f]+"), " ").trim().take(max)

    /** "java.lang.IllegalStateException: boom @ A.run(A.kt:12) < B.go(B.kt:30) < C.x(C.kt:4)", at most 300 characters. */
    fun crashText(t: Throwable): String {
        val frames = t.stackTrace.take(3).joinToString(" < ") { "${it.className.substringAfterLast('.')}.${it.methodName}(${it.fileName ?: "?"}:${it.lineNumber})" }
        return clip("${t.javaClass.name}: ${t.message ?: ""}${if (frames.isNotEmpty()) " @ $frames" else ""}")
    }

    /** The error while it is still worth showing (7 days), else null. */
    fun alive(e: LastError?, now: Long): LastError? = if (e != null && e.text.isNotEmpty() && now - e.at in 0..KEEP_MS) e else null

    /** The newer of two errors; a newer one replaces the older. */
    fun newer(a: LastError?, b: LastError?): LastError? = when { a == null -> b; b == null -> a; b.at >= a.at -> b; else -> a }

    /** Counts failures in a row. [fail] is true each time the count reaches [threshold] (then it starts over); [ok] resets it. */
    class Streak(private val threshold: Int = 3) {
        private var n = 0
        @Synchronized fun fail(): Boolean { n++; if (n >= threshold) { n = 0; return true }; return false }
        @Synchronized fun ok() { n = 0 }
    }

    /** Whether Settings.Secure.enabled_accessibility_services (a ":"-separated list) holds this service, in either spelling. */
    fun serviceEnabled(setting: String?, pkg: String, cls: String): Boolean {
        if (setting.isNullOrBlank()) return false
        val full = "$pkg/$cls"
        val short = "$pkg/${cls.removePrefix(pkg)}"
        return setting.split(':').any { it.equals(full, true) || it.equals(short, true) }
    }

    /** Flags are null when not known; the website shows "unknown" for those. */
    data class Flags(
        val overlay: Boolean? = null, val notifications: Boolean? = null, val camera: Boolean? = null, val microphone: Boolean? = null,
        val batteryUnrestricted: Boolean? = null, val accessibility: Boolean? = null
    )

    fun build(appVersion: String, versionCode: Int, sdk: Int, model: String, err: LastError?, flags: Flags): JSONObject {
        val j = JSONObject().put("appVersion", appVersion).put("versionCode", versionCode).put("sdk", sdk).put("model", clip(model, 40))
        flags.overlay?.let { j.put("overlay", it) }
        flags.notifications?.let { j.put("notifications", it) }
        flags.camera?.let { j.put("camera", it) }
        flags.microphone?.let { j.put("microphone", it) }
        flags.batteryUnrestricted?.let { j.put("batteryUnrestricted", it) }
        flags.accessibility?.let { j.put("accessibility", it) }
        j.put("lastError", err?.let { JSONObject().put("at", it.at).put("where", clip(it.where, 40)).put("text", clip(it.text)) } ?: JSONObject.NULL)
        return j
    }

    /** What is wrong on the tablet, red (stops a feature) first. Same words as the website's Health tab. */
    fun problems(f: Flags): List<Problem> {
        val out = ArrayList<Problem>()
        fun add(ok: Boolean?, id: String, label: String, fix: String, red: Boolean) { if (ok == false) out.add(Problem(id, label, fix, red)) }
        add(f.overlay, "overlay", "Cannot show messages over other apps", "Settings → Apps → Stashr Hub → Display over other apps → allow. Without it announcements show only as a notification.", true)
        add(f.camera, "camera", "Camera is not allowed", "Settings → Apps → Stashr Hub → Permissions → Camera → allow.", true)
        add(f.notifications, "notifications", "Notifications are off", "Settings → Apps → Stashr Hub → Notifications → allow.", false)
        add(f.microphone, "microphone", "Microphone is not allowed", "Settings → Apps → Stashr Hub → Permissions → Microphone → allow (for Hey Stashr).", false)
        add(f.batteryUnrestricted, "batteryUnrestricted", "Battery limits apply", "Settings → Apps → Stashr Hub → Battery → Unrestricted. Keep the tablet charging.", false)
        add(f.accessibility, "accessibility", "WhatsApp helper (Accessibility) is off", "Only for WhatsApp messages: Settings → Accessibility → Stashr Hub → on.", false)
        return out.sortedByDescending { it.red }
    }
}

/** The Android side: reads the real permissions, keeps the last error across crashes, installs the crash handler. */
object Health {
    private const val FILE = "stashr-health"
    @Volatile private var app: Context? = null
    private val streaks = HashMap<String, HealthLogic.Streak>()
    @Volatile private var lastNote = ""
    @Volatile private var lastNoteAt = 0L

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Call once from Application.onCreate. */
    fun install(application: Application) {
        app = application
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try { save(application, HealthLogic.LastError(System.currentTimeMillis(), "crash", HealthLogic.crashText(e)), sync = true) } catch (_: Throwable) { }
            previous?.uncaughtException(t, e)
        }
    }

    private fun save(ctx: Context, e: HealthLogic.LastError, sync: Boolean) {
        val ed = prefs(ctx).edit().putLong("errAt", e.at).putString("errWhere", e.where).putString("errText", HealthLogic.clip(e.text))
        if (sync) ed.commit() else ed.apply()
    }

    /** A failure worth knowing about; the newest one is kept for 7 days. Same text within a minute is not written again. */
    fun note(where: String, text: String) {
        val ctx = app ?: return
        val now = System.currentTimeMillis()
        val key = "$where:$text"
        if (key == lastNote && now - lastNoteAt < 60_000) return
        lastNote = key; lastNoteAt = now
        try { save(ctx, HealthLogic.LastError(now, where, text), sync = false) } catch (_: Throwable) { }
    }

    /** [note], but only on the [threshold]-th failure in a row for this [where]; [success] resets the count. */
    fun noteStreak(where: String, text: String, threshold: Int = 3) {
        val s = synchronized(streaks) { streaks.getOrPut(where) { HealthLogic.Streak(threshold) } }
        if (s.fail()) note(where, text)
    }
    fun success(where: String) { synchronized(streaks) { streaks[where] }?.ok() }

    fun lastError(ctx: Context): HealthLogic.LastError? {
        val p = prefs(ctx)
        val at = p.getLong("errAt", 0L)
        if (at == 0L) return null
        val e = HealthLogic.LastError(at, p.getString("errWhere", "") ?: "", p.getString("errText", "") ?: "")
        val alive = HealthLogic.alive(e, System.currentTimeMillis())
        if (alive == null) p.edit().clear().apply()
        return alive
    }

    private fun granted(ctx: Context, perm: String) = ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    fun flags(ctx: Context): HealthLogic.Flags {
        val c = ctx.applicationContext
        val acc = try {
            val svc = ComponentName(c, "com.tanush.stashr.hub.whatsapp.WhatsAppAccessibility")
            HealthLogic.serviceEnabled(Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), svc.packageName, svc.className)
        } catch (_: Exception) { null }
        return HealthLogic.Flags(
            overlay = try { Settings.canDrawOverlays(c) } catch (_: Exception) { null },
            notifications = try { NotificationManagerCompat.from(c).areNotificationsEnabled() } catch (_: Exception) { null },
            camera = granted(c, Manifest.permission.CAMERA),
            microphone = granted(c, Manifest.permission.RECORD_AUDIO),
            batteryUnrestricted = try { (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName) } catch (_: Exception) { null },
            accessibility = acc
        )
    }

    /** The `health` object of the tablet's status. */
    fun collect(ctx: Context): JSONObject =
        HealthLogic.build(com.tanush.stashr.hub.BuildConfig.VERSION_NAME, com.tanush.stashr.hub.BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT, DeviceInfo.model(), lastError(ctx), flags(ctx))

    /** Phone mode of this app (battery and storage only): the same object without the tablet-only flags. */
    fun collectPhone(ctx: Context): JSONObject {
        val f = flags(ctx)
        return HealthLogic.build(com.tanush.stashr.hub.BuildConfig.VERSION_NAME, com.tanush.stashr.hub.BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT, DeviceInfo.model(), lastError(ctx),
            HealthLogic.Flags(notifications = f.notifications, batteryUnrestricted = f.batteryUnrestricted))
    }

    fun problems(ctx: Context): List<HealthLogic.Problem> = HealthLogic.problems(flags(ctx))
}

/** Starts the crash handler before anything else runs. */
class StashrHubApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Health.install(this)
    }
}

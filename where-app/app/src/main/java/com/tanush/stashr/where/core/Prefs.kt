package com.tanush.stashr.where.core

import android.content.Context

/** What the app remembers: the server, its device token, the person's name, the last fix and the server's last answer. */
class Prefs(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("stashr-where", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: com.tanush.stashr.where.BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()

    /** The backup server. Both servers share one database, so the same device token works on either. */
    var server2: String
        get() = p.getString("server2", null) ?: com.tanush.stashr.where.BuildConfig.DEFAULT_SERVER2
        set(v) = p.edit().putString("server2", v.trim().trimEnd('/')).apply()

    /** The server that answered last: tried first next time. */
    private var good: String
        get() = p.getString("serverGood", "") ?: ""
        set(v) = p.edit().putString("serverGood", v).apply()

    /** Both servers, the one that worked last first. */
    val servers: List<String>
        get() {
            val all = listOf(server, server2).filter { it.startsWith("https://") }.distinct()
            return if (good in all) listOf(good) + all.filter { it != good } else all
        }

    fun serverWorked(url: String) { if (good != url) good = url }
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v).apply()
    var name: String
        get() = p.getString("name", "") ?: ""
        set(v) = p.edit().putString("name", v).apply()

    val linked get() = token.isNotEmpty()

    /** The last fix the phone took (shown on the main screen). */
    var fixLat: Double get() = Double.fromBits(p.getLong("fixLat", Double.NaN.toRawBits())); set(v) = p.edit().putLong("fixLat", v.toRawBits()).apply()
    var fixLon: Double get() = Double.fromBits(p.getLong("fixLon", Double.NaN.toRawBits())); set(v) = p.edit().putLong("fixLon", v.toRawBits()).apply()
    var fixAcc: Float get() = p.getFloat("fixAcc", 0f); set(v) = p.edit().putFloat("fixAcc", v).apply()
    var fixAt: Long get() = p.getLong("fixAt", 0L); set(v) = p.edit().putLong("fixAt", v).apply()
    var fixSpeed: Float get() = p.getFloat("fixSpeed", -1f); set(v) = p.edit().putFloat("fixSpeed", v).apply()

    /** A fix from the passive provider waiting to be uploaded by the worker. */
    var pendingLat: Double get() = Double.fromBits(p.getLong("pLat", Double.NaN.toRawBits())); set(v) = p.edit().putLong("pLat", v.toRawBits()).apply()
    var pendingLon: Double get() = Double.fromBits(p.getLong("pLon", Double.NaN.toRawBits())); set(v) = p.edit().putLong("pLon", v.toRawBits()).apply()
    var pendingAcc: Float get() = p.getFloat("pAcc", 0f); set(v) = p.edit().putFloat("pAcc", v).apply()
    var pendingAt: Long get() = p.getLong("pAt", 0L); set(v) = p.edit().putLong("pAt", v).apply()
    var pendingSpeed: Float get() = p.getFloat("pSpeed", -1f); set(v) = p.edit().putFloat("pSpeed", v).apply()

    /** The last fix that reached the server. */
    var upLat: Double get() = Double.fromBits(p.getLong("upLat", Double.NaN.toRawBits())); set(v) = p.edit().putLong("upLat", v.toRawBits()).apply()
    var upLon: Double get() = Double.fromBits(p.getLong("upLon", Double.NaN.toRawBits())); set(v) = p.edit().putLong("upLon", v.toRawBits()).apply()
    var upAt: Long get() = p.getLong("upAt", 0L); set(v) = p.edit().putLong("upAt", v).apply()

    /** Wi-Fi access point at the last coordinate upload ("" if not on Wi-Fi), and when the last call of any kind reached the server. */
    var upBssid: String get() = p.getString("upBssid", "") ?: ""; set(v) = p.edit().putString("upBssid", v).apply()
    var callAt: Long get() = p.getLong("callAt", 0L); set(v) = p.edit().putLong("callAt", v).apply()
    /** The last call was the small "still here" one. */
    var lastWasSame: Boolean get() = p.getBoolean("lastWasSame", false); set(v) = p.edit().putBoolean("lastWasSame", v).apply()

    var state: String get() = p.getString("state", "") ?: ""; set(v) = p.edit().putString("state", v).apply()
    var distanceKm: Float get() = p.getFloat("distanceKm", -1f); set(v) = p.edit().putFloat("distanceKm", v).apply()
    var etaMinutes: Int get() = p.getInt("etaMinutes", -1); set(v) = p.edit().putInt("etaMinutes", v).apply()
    var lastError: String get() = p.getString("lastError", "") ?: ""; set(v) = p.edit().putString("lastError", v).apply()
    /** True (and remembers now) when the last check from opening the app was more than [ms] ago. */
    fun lastActivityCheck(ms: Long): Boolean {
        val now = System.currentTimeMillis()
        if (now - p.getLong("openCheckAt", 0L) < ms) return false
        p.edit().putLong("openCheckAt", now).apply()
        return true
    }
    /** The last answer said a family TV is showing the live map. */
    var live: Boolean get() = p.getBoolean("live", false); set(v) = p.edit().putBoolean("live", v).apply()
    var lastDelaySec: Int get() = p.getInt("lastDelaySec", Logic.DEFAULT_DELAY_SEC); set(v) = p.edit().putInt("lastDelaySec", v).apply()

    /** Notice ids already shown, newest last (so a repeated notice is not shown twice). */
    var seenNotices: List<String>
        get() = (p.getString("seen", "") ?: "").split('\u0001').filter { it.isNotEmpty() }
        set(v) = p.edit().putString("seen", v.takeLast(40).joinToString("\u0001")).apply()

    var updateVersion: String get() = p.getString("updVersion", "") ?: ""; set(v) = p.edit().putString("updVersion", v).apply()
    var updateCheckedAt: Long get() = p.getLong("updChecked", 0L); set(v) = p.edit().putLong("updChecked", v).apply()
    /** Shown on the setup screen once, e.g. "Stashr disconnected this phone". */
    var message: String get() = p.getString("message", "") ?: ""; set(v) = p.edit().putString("message", v).apply()

    /** Forget the link (Disconnect, or the server no longer knows this phone). The server address stays. */
    fun unlink() {
        val keepServer = server
        p.edit().clear().apply()
        server = keepServer
    }
}

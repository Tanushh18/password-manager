package com.tanush.stashr.tv.core

import android.content.Context

/** What the app remembers: the two servers, the device token, the TV's name and where each movie was left. */
class Prefs(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("stashr-tv", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: com.tanush.stashr.tv.BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()

    /** The backup server. Both servers share one database, so the same device token works on either. */
    var server2: String
        get() = p.getString("server2", null) ?: com.tanush.stashr.tv.BuildConfig.DEFAULT_SERVER2
        set(v) = p.edit().putString("server2", v.trim().trimEnd('/')).apply()

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
    var deviceName: String
        get() = p.getString("deviceName", "") ?: ""
        set(v) = p.edit().putString("deviceName", v).apply()
    var lastUploadAt: Long
        get() = p.getLong("lastUploadAt", 0)
        set(v) = p.edit().putLong("lastUploadAt", v).apply()
    var lastUploadName: String
        get() = p.getString("lastUploadName", "") ?: ""
        set(v) = p.edit().putString("lastUploadName", v).apply()
    var lastReportOk: Long
        get() = p.getLong("lastReportOk", 0)
        set(v) = p.edit().putLong("lastReportOk", v).apply()
    var lastError: String
        get() = p.getString("lastError", "") ?: ""
        set(v) = p.edit().putString("lastError", v).apply()

    /** The local date (yyyy-MM-dd) on which the morning panel was last shown. */
    var morningShown: String
        get() = p.getString("morningShown", "") ?: ""
        set(v) = p.edit().putString("morningShown", v).apply()
    /** The last good answer of /home/agent/tv-home, kept so the launcher is not empty while offline. */
    var homeCache: String
        get() = p.getString("homeCache", "") ?: ""
        set(v) = p.edit().putString("homeCache", v).apply()

    fun position(name: String): Long = p.getLong("pos_" + name.hashCode(), 0)
    fun savePosition(name: String, ms: Long) = p.edit().putLong("pos_" + name.hashCode(), ms).apply()

    val linked get() = token.startsWith("sh_")

    fun unlink() = p.edit().remove("token").remove("deviceName").apply()
}

package com.tanush.stashr.cast.core

import android.content.Context
import org.json.JSONObject

/** What the app remembers: the quality, the sound switch, a saved token per TV, and the update check. */
class Prefs(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("stashr-cast", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: com.tanush.stashr.cast.BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()
    var server2: String
        get() = p.getString("server2", null) ?: com.tanush.stashr.cast.BuildConfig.DEFAULT_SERVER2
        set(v) = p.edit().putString("server2", v.trim().trimEnd('/')).apply()
    private var good: String
        get() = p.getString("serverGood", "") ?: ""
        set(v) = p.edit().putString("serverGood", v).apply()

    /** Both servers (only for the update check), the one that worked last first. */
    val servers: List<String>
        get() {
            // The built-in addresses always come after the saved ones: an address saved by an older version of the app (say, only the old
            // server) must never hide the current servers. The one that answered last is tried first.
            val all = (listOf(server, server2) + com.tanush.stashr.cast.BuildConfig.DEFAULT_SERVERS.split(",")).map { it.trim() }.filter { it.startsWith("https://") }.distinct()
            return if (good in all) listOf(good) + all.filter { it != good } else all
        }
    fun serverWorked(url: String) { if (good != url) good = url }

    var quality: String get() = p.getString("quality", "sharp") ?: "sharp"; set(v) = p.edit().putString("quality", v).apply()
    var sendSound: Boolean get() = p.getBoolean("sound", true); set(v) = p.edit().putBoolean("sound", v).apply()
    /** The TV picked last (its name or typed address). */
    var lastTv: String get() = p.getString("lastTv", "") ?: ""; set(v) = p.edit().putString("lastTv", v).apply()
    /** Manually added TV addresses ("host" or "host:port"). */
    var manualTvs: List<String>
        get() = (p.getString("manual", "") ?: "").split('\u0001').filter { it.isNotEmpty() }
        set(v) = p.edit().putString("manual", v.distinct().take(8).joinToString("\u0001")).apply()

    /** Tokens the TVs gave us, by TV key: after the first PIN a tap is enough. */
    fun tokenFor(tv: String): String = try { JSONObject(p.getString("tokens", "{}") ?: "{}").optString(tv, "") } catch (e: Exception) { "" }
    fun saveToken(tv: String, token: String) {
        val o = try { JSONObject(p.getString("tokens", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
        p.edit().putString("tokens", o.put(tv, token).toString()).apply()
    }
    fun forgetToken(tv: String) {
        val o = try { JSONObject(p.getString("tokens", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
        o.remove(tv)
        p.edit().putString("tokens", o.toString()).apply()
    }

    var updateVersion: String get() = p.getString("updVersion", "") ?: ""; set(v) = p.edit().putString("updVersion", v).apply()
    var updateCheckedAt: Long get() = p.getLong("updChecked", 0L); set(v) = p.edit().putLong("updChecked", v).apply()
}

package com.tanush.stashr.hub.core

import android.content.Context

/** What the app remembers: the server, its device token, and whether this is the home tablet or a family phone. */
class Prefs(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("stashr-hub", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: com.tanush.stashr.hub.BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v).apply()
    /** "hub" (the home tablet) or "phone" (a family phone). Empty until paired. */
    var role: String
        get() = p.getString("role", "") ?: ""
        set(v) = p.edit().putString("role", v).apply()
    var deviceName: String
        get() = p.getString("deviceName", "") ?: ""
        set(v) = p.edit().putString("deviceName", v).apply()
    var cameraArmed: Boolean
        get() = p.getBoolean("cameraArmed", false)
        set(v) = p.edit().putBoolean("cameraArmed", v).apply()
    var voiceOn: Boolean
        get() = p.getBoolean("voiceOn", true)
        set(v) = p.edit().putBoolean("voiceOn", v).apply()
    var cameraSensitivity: Int
        get() = p.getInt("cameraSensitivity", 5)
        set(v) = p.edit().putInt("cameraSensitivity", v).apply()
    var cameraVideo: Boolean
        get() = p.getBoolean("cameraVideo", true)
        set(v) = p.edit().putBoolean("cameraVideo", v).apply()

    var shareLocation: Boolean
        get() = p.getBoolean("shareLocation", false)
        set(v) = p.edit().putBoolean("shareLocation", v).apply()

    val paired get() = token.startsWith("sh_") && role.isNotEmpty()

    fun forget() = p.edit().remove("token").remove("role").remove("deviceName").apply()
}

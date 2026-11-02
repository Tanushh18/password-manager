package com.tanush.stashr.cast.core

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** An error answer from the server, with its own message. */
class ApiError(val status: Int, message: String) : IOException(message)

/**
 * The only thing Stashr Cast asks the Stashr server is "is there a newer version of this app?". Mirroring itself goes straight
 * from the phone to the TV and never touches the server.
 */
class Api(ctx: Context) {
    private val prefs = Prefs(ctx)
    @Volatile private var base: String = prefs.servers.firstOrNull() ?: prefs.server

    private fun <T> failover(block: () -> T): T {
        var last: IOException? = null
        for (s in prefs.servers.ifEmpty { listOf(prefs.server) }) {
            base = s
            try { val r = block(); prefs.serverWorked(s); return r }
            catch (e: ApiError) { if (e.status !in 502..504) throw e; last = e }
            catch (e: IOException) { last = e }
        }
        throw last ?: IOException("No server to reach.")
    }

    private fun get(path: String): JSONObject = failover {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = "GET"; c.connectTimeout = 20000; c.readTimeout = 20000
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "StashrCast/" + com.tanush.stashr.cast.BuildConfig.VERSION_NAME)
        try {
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw ApiError(code, json.optString("error", "The server answered HTTP $code."))
            json
        } finally { c.disconnect() }
    }

    /** GET /api/mobile-updates/cast/latest. A 404 (no release yet) is reported as "no update". */
    fun latest(currentVersionCode: Int): JSONObject = try {
        get("/api/mobile-updates/cast/latest?currentVersionCode=$currentVersionCode")
    } catch (e: ApiError) { if (e.status == 404) JSONObject().put("updateAvailable", false) else throw e }

    fun download(url: String, into: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 120000
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Download failed: HTTP ${c.responseCode}")
            c.inputStream.use { input -> into.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }
}

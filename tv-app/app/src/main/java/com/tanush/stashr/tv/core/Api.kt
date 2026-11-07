package com.tanush.stashr.tv.core

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** An error answer from the server, with its own message. 401 means this TV is no longer linked. */
class ApiError(val status: Int, message: String) : IOException(message)

/** Talks to the Stashr server with the TV's token. Blocking: call from a background thread. */
class Api(ctx: Context) {
    private val prefs = Prefs(ctx)
    @Volatile var base: String = prefs.servers.firstOrNull() ?: prefs.server
        private set

    /** Tries each server in turn: the one that worked last, then the other. Only a missing connection or a 502-504 moves on. */
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

    private fun open(path: String, method: String, auth: Boolean, timeoutMs: Int): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "StashrTV/" + com.tanush.stashr.tv.BuildConfig.VERSION_NAME)
        if (auth) c.setRequestProperty("Authorization", "Bearer " + prefs.token)
        return c
    }

    private fun read(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
        if (code !in 200..299) throw ApiError(code, json.optString("error", "The server answered HTTP $code."))
        return json
    }

    private fun get(path: String, auth: Boolean, timeoutMs: Int = 20000): JSONObject = failover {
        val c = open(path, "GET", auth, timeoutMs)
        try { read(c) } finally { c.disconnect() }
    }

    private fun post(path: String, body: JSONObject, auth: Boolean, timeoutMs: Int = 20000): JSONObject = failover {
        val c = open(path, "POST", auth, timeoutMs)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            read(c)
        } finally { c.disconnect() }
    }

    /** POST /home/agent/link: the home-device code from the Stashr website and a name for this TV; { token, device } out. */
    fun link(code: String, name: String): JSONObject = post("/home/agent/link", JSONObject().put("code", code).put("name", name).put("kind", "tv"), auth = false)

    /** POST /home/agent/report: status (and acks) in, { commands: [{ id, type, args }] } out. */
    fun report(body: JSONObject): JSONObject = post("/home/agent/report", body, auth = true, timeoutMs = 30000)

    /** GET /home/movies/grant: a short-lived Drive token so the movie comes straight from Google. Throws when unavailable. */
    fun movieGrant(): JSONObject = get("/home/movies/grant", auth = true, timeoutMs = 20000)

    /** A direct Drive download with the granted token; the caller reads the stream and disconnects. */
    fun driveConnection(apiBase: String, fileId: String, token: String, start: Long): HttpURLConnection {
        val c = URL(apiBase.trimEnd('/') + "/drive/v3/files/" + URLEncoder.encode(fileId, "UTF-8") + "?alt=media&supportsAllDrives=true").openConnection() as HttpURLConnection
        c.connectTimeout = 30000; c.readTimeout = 60000
        c.setRequestProperty("Authorization", "Bearer $token")
        if (start > 0) c.setRequestProperty("Range", "bytes=$start-")
        return c
    }

    /** GET /home/movies/manifest: { mode: "mirror" | "move", files: [{ name, size, path }] }. */
    fun manifest(): JSONObject = get("/home/movies/manifest", auth = true, timeoutMs = 45000)

    /** GET /home/movies/file?path=…, continuing from byte [start]. The caller reads the stream and disconnects. */
    fun fileConnection(path: String, start: Long): HttpURLConnection {
        var last: IOException? = null
        for (s in prefs.servers.ifEmpty { listOf(prefs.server) }) {
            base = s
            var c: HttpURLConnection? = null
            try {
                c = open("/home/movies/file?path=" + URLEncoder.encode(path, "UTF-8"), "GET", true, 30000)
                c.readTimeout = 60000
                if (start > 0) c.setRequestProperty("Range", "bytes=$start-")
                val code = c.responseCode
                if (code in 200..299) { prefs.serverWorked(s); return c }
                c.disconnect()
                if (code in 502..504) { last = ApiError(code, "The server answered HTTP $code."); continue }
                throw ApiError(code, if (code == 404) "The movie is no longer on Drive." else "The server answered HTTP $code.")
            } catch (e: ApiError) { throw e }
            catch (e: IOException) { c?.disconnect(); last = e }
        }
        throw last ?: IOException("No server to reach.")
    }

    /** GET /home/agent/tv-home: weather, headlines, movie night, who is on the way home. */
    fun tvHome(): JSONObject = get("/home/agent/tv-home", auth = true, timeoutMs = 20000)

    /** GET /home/agent/tv-live: the family members who are out, with the road home. Each call keeps their phones in fast mode for 2 minutes. */
    fun tvLive(): JSONObject = get("/home/agent/tv-live", auth = true, timeoutMs = 8000)

    /** GET /api/mobile-updates/tv/latest. */
    fun latest(currentVersionCode: Int): JSONObject = get("/api/mobile-updates/tv/latest?currentVersionCode=$currentVersionCode", auth = true)   // the device token tells Stashr which TV is asking

    fun download(url: String, into: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 120000
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Download failed: HTTP ${c.responseCode}")
            c.inputStream.use { input -> into.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }
}

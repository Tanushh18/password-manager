package com.tanush.stashr.where.core

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** An error answer from the server, with its own message. 401 means this phone is no longer linked. */
class ApiError(val status: Int, message: String) : IOException(message)

/** Talks to the Stashr server. Blocking: call from a background thread or Dispatchers.IO. */
class Api(ctx: Context) {
    private val prefs = Prefs(ctx)
    val base get() = prefs.server

    private fun open(path: String, method: String, auth: Boolean, timeoutMs: Int): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "StashrLocation/" + com.tanush.stashr.where.BuildConfig.VERSION_NAME)
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

    private fun get(path: String, auth: Boolean): JSONObject {
        val c = open(path, "GET", auth, 20000)
        try { return read(c) } finally { c.disconnect() }
    }

    private fun post(path: String, body: JSONObject, auth: Boolean, timeoutMs: Int = 20000): JSONObject {
        val c = open(path, "POST", auth, timeoutMs)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            return read(c)
        } finally { c.disconnect() }
    }

    /** POST /home/agent/link: the code from the Stashr website and the person's name in; { token, name, deviceId } out. */
    fun link(code: String, name: String): JSONObject = post("/home/agent/link", JSONObject().put("code", code).put("name", name), auth = false)

    /** POST /home/agent/unlink: tells Stashr this phone disconnected itself. */
    fun unlink(): JSONObject = post("/home/agent/unlink", JSONObject(), auth = true)

    /** POST /home/agent/location. */
    fun location(body: JSONObject): JSONObject = post("/home/agent/location", body, auth = true, timeoutMs = 30000)

    /** GET /api/mobile-updates/where/latest. */
    fun latest(currentVersionCode: Int): JSONObject = get("/api/mobile-updates/where/latest?currentVersionCode=$currentVersionCode", auth = false)

    fun download(url: String, into: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 120000
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Download failed: HTTP ${c.responseCode}")
            c.inputStream.use { input -> into.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }
}

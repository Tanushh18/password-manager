package com.tanush.stashr.hub.local

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.tanush.stashr.hub.BuildConfig
import com.tanush.stashr.hub.core.Prefs
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * The tablet's small server for the home Wi-Fi (port 8765): the TV talks to it when the Stashr server cannot be reached.
 * Every request needs the home key the server handed out (X-Stashr-Key). Routes: GET /v1/ping, POST /v1/tv/report.
 * The tablet is advertised as the "_stashr-hub._tcp" service so the TV can find it without knowing its address.
 */
object LocalServer {
    const val PORT = 8765
    @Volatile private var socket: ServerSocket? = null
    private var nsd: NsdManager? = null
    private var listener: NsdManager.RegistrationListener? = null

    @Synchronized fun ensureStarted(ctx: Context) {
        val app = ctx.applicationContext
        if (socket != null || Prefs(app).localKey.isEmpty()) return
        try { socket = ServerSocket(PORT) } catch (e: Exception) { return }
        val s = socket!!
        thread(name = "stashr-local-server", isDaemon = true) {
            while (!s.isClosed) {
                val c = try { s.accept() } catch (e: Exception) { break }
                thread(isDaemon = true) { handle(app, c) }
            }
        }
        try {
            val m = app.getSystemService(Context.NSD_SERVICE) as NsdManager
            val info = NsdServiceInfo().apply { serviceName = "stashr-hub"; serviceType = "_stashr-hub._tcp."; port = PORT }
            val l = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(i: NsdServiceInfo) {}
                override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) {}
                override fun onServiceUnregistered(i: NsdServiceInfo) {}
                override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
            }
            m.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
            nsd = m; listener = l
        } catch (e: Exception) { }
    }

    @Synchronized fun stop() {
        try { listener?.let { nsd?.unregisterService(it) } } catch (e: Exception) { }
        listener = null; nsd = null
        try { socket?.close() } catch (e: Exception) { }
        socket = null
    }

    private fun readLine(i: InputStream, cap: Int): String? {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read(); if (c < 0) return if (b.size() == 0) null else b.toString("UTF-8")
            if (c == '\n'.code) return b.toString("UTF-8").trimEnd('\r')
            if (b.size() >= cap) return null
            b.write(c)
        }
    }

    private fun reply(c: Socket, code: Int, body: JSONObject) {
        val text = when (code) { 200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"; else -> "Error" }
        val bytes = body.toString().toByteArray()
        c.getOutputStream().use { o ->
            o.write("HTTP/1.1 $code $text\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n".toByteArray())
            o.write(bytes); o.flush()
        }
    }

    private fun handle(app: Context, c: Socket) {
        try {
            c.soTimeout = 5000
            val i = c.getInputStream()
            val request = readLine(i, 2048) ?: return
            val parts = request.split(" ")
            if (parts.size < 2) return reply(c, 400, JSONObject().put("error", "bad request"))
            var length = 0; var key = ""; var used = request.length
            while (true) {
                val line = readLine(i, 2048) ?: return reply(c, 400, JSONObject().put("error", "bad request"))
                used += line.length + 2
                if (used > 8192) return reply(c, 400, JSONObject().put("error", "headers too big"))
                if (line.isEmpty()) break
                val idx = line.indexOf(':'); if (idx < 0) continue
                val name = line.substring(0, idx).trim().lowercase(); val value = line.substring(idx + 1).trim()
                if (name == "content-length") length = value.toIntOrNull() ?: 0
                if (name == "x-stashr-key") key = value
            }
            val expected = Prefs(app).localKey
            if (expected.isEmpty() || !MessageDigest.isEqual(key.toByteArray(), expected.toByteArray())) return reply(c, 401, JSONObject().put("error", "bad key"))
            if (length > 64 * 1024) return reply(c, 400, JSONObject().put("error", "body too big"))
            val body = ByteArray(length); var read = 0
            while (read < length) { val n = i.read(body, read, length - read); if (n < 0) break; read += n }
            val path = parts[1].substringBefore('?')
            when {
                parts[0] == "GET" && path == "/v1/ping" -> reply(c, 200, JSONObject().put("ok", true).put("kind", "hub").put("name", Prefs(app).deviceName).put("version", BuildConfig.VERSION_NAME))
                parts[0] == "POST" && path == "/v1/tv/report" -> {
                    val j = try { JSONObject(String(body, 0, read)) } catch (e: Exception) { return reply(c, 400, JSONObject().put("error", "bad json")) }
                    reply(c, 200, JSONObject().put("commands", LocalMode.tvReport(j.optString("name"), j.optJSONObject("status"))))
                }
                else -> reply(c, 404, JSONObject().put("error", "not found"))
            }
        } catch (e: Exception) {
        } finally { try { c.close() } catch (e: Exception) { } }
    }
}

package com.tanush.stashr.tv.net

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/**
 * A tiny HTTP/1.1 client over a plain socket for the tablet on the home Wi-Fi. HttpURLConnection refuses http:// when
 * cleartext traffic is off (it is off for the whole app, so nothing else can use it); a socket is not covered by that
 * policy. Only used with private addresses (see LocalPolicy.privateHost). Replies are small JSON.
 */
object RawHttp {
    class Response(val status: Int, val body: String)

    private const val MAX_BYTES = 1_000_000

    fun request(host: String, port: Int, method: String, path: String, key: String, body: String? = null, timeoutMs: Int = 4000): Response {
        Socket().use { s ->
            s.connect(InetSocketAddress(host, port), timeoutMs)
            s.soTimeout = timeoutMs
            val payload = body?.toByteArray(Charsets.UTF_8)
            val head = buildString {
                append("$method $path HTTP/1.1\r\nHost: $host:$port\r\nX-Stashr-Key: $key\r\nAccept: application/json\r\nConnection: close\r\n")
                if (payload != null) append("Content-Type: application/json\r\nContent-Length: ${payload.size}\r\n")
                append("\r\n")
            }
            val out = s.getOutputStream()
            out.write(head.toByteArray(Charsets.US_ASCII))
            if (payload != null) out.write(payload)
            out.flush()
            val buf = ByteArrayOutputStream()
            val tmp = ByteArray(4096)
            val input = s.getInputStream()
            while (true) {
                val n = input.read(tmp)
                if (n < 0) break
                buf.write(tmp, 0, n)
                if (buf.size() > MAX_BYTES) throw IOException("Reply too big")
            }
            return parse(buf.toByteArray())
        }
    }

    /** Splits a raw HTTP reply into its status and body (plain, Content-Length or chunked). */
    fun parse(raw: ByteArray): Response {
        val sep = indexOf(raw, "\r\n\r\n".toByteArray())
        if (sep < 0) throw IOException("Not an HTTP reply")
        val head = String(raw, 0, sep, Charsets.ISO_8859_1).split("\r\n")
        val status = head.firstOrNull()?.split(" ")?.getOrNull(1)?.toIntOrNull() ?: throw IOException("Bad status line")
        val headers = head.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
        val bodyBytes = raw.copyOfRange(sep + 4, raw.size)
        val data = when {
            headers["transfer-encoding"]?.contains("chunked", ignoreCase = true) == true -> dechunk(bodyBytes)
            headers["content-length"]?.toIntOrNull() != null -> bodyBytes.copyOf(minOf(bodyBytes.size, headers["content-length"]!!.toInt()))
            else -> bodyBytes
        }
        return Response(status, String(data, Charsets.UTF_8))
    }

    private fun dechunk(b: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < b.size) {
            val eol = indexOf(b, "\r\n".toByteArray(), i)
            if (eol < 0) break
            val size = String(b, i, eol - i, Charsets.US_ASCII).substringBefore(';').trim().toIntOrNull(16) ?: break
            if (size == 0) break
            val start = eol + 2
            if (start + size > b.size) { out.write(b, start, b.size - start); break }
            out.write(b, start, size)
            i = start + size + 2
        }
        return out.toByteArray()
    }

    private fun indexOf(a: ByteArray, pat: ByteArray, from: Int = 0): Int {
        outer@ for (i in from..a.size - pat.size) {
            for (j in pat.indices) if (a[i + j] != pat[j]) continue@outer
            return i
        }
        return -1
    }
}

package com.tanush.stashr.hub.net

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class SpeedResult(val at: Long, val down: Double, val up: Double, val ping: Int, val server: String) {
    fun toJson(): JSONObject = JSONObject().put("at", at).put("down", down).put("up", up).put("ping", ping).put("server", server)
}

/** Internet speed against Cloudflare's speed test servers: ping, download and upload. Blocking; call off the main thread. */
object SpeedTest {
    private const val BASE = "https://speed.cloudflare.com"
    private const val DOWN_BYTES = 25_000_000
    private const val UP_BYTES = 5_000_000

    private fun conn(url: String, method: String = "GET"): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = method; connectTimeout = 10_000; readTimeout = 30_000; useCaches = false
        setRequestProperty("User-Agent", "StashrHub")
    }

    private fun round1(v: Double) = Math.round(v * 10) / 10.0

    fun ping(): Int {
        val times = ArrayList<Long>()
        repeat(5) {
            val c = conn("$BASE/__down?bytes=0")
            try {
                val t0 = System.nanoTime()
                c.inputStream.use { it.readBytes() }
                times.add((System.nanoTime() - t0) / 1_000_000)
            } catch (e: Exception) { } finally { c.disconnect() }
        }
        if (times.isEmpty()) throw IllegalStateException("The speed test server did not answer.")
        times.sort()
        return times[times.size / 2].toInt()
    }

    fun download(): Double {
        val c = conn("$BASE/__down?bytes=$DOWN_BYTES")
        try {
            val buf = ByteArray(64 * 1024)
            var total = 0L
            val t0 = System.nanoTime()
            c.inputStream.use { input -> while (true) { val n = input.read(buf); if (n < 0) break; total += n } }
            val secs = (System.nanoTime() - t0) / 1e9
            return round1(total * 8 / secs / 1e6)
        } finally { c.disconnect() }
    }

    fun upload(): Double {
        val c = conn("$BASE/__up", "POST")
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/octet-stream")
            c.setFixedLengthStreamingMode(UP_BYTES)
            val chunk = ByteArray(64 * 1024)
            val t0 = System.nanoTime()
            c.outputStream.use { out -> var left = UP_BYTES; while (left > 0) { val n = minOf(left, chunk.size); out.write(chunk, 0, n); left -= n } }
            c.inputStream.use { it.readBytes() }
            val secs = (System.nanoTime() - t0) / 1e9
            return round1(UP_BYTES * 8 / secs / 1e6)
        } finally { c.disconnect() }
    }

    suspend fun run(): SpeedResult {
        val p = ping()
        val d = download()
        val u = upload()
        return SpeedResult(System.currentTimeMillis(), d, u, p, "Cloudflare")
    }
}

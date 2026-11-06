package com.tanush.stashr.cast.core

import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * The parts of Stashr Cast that need no Android: the wire protocol the TV understands, the picture size, the quality
 * presets and the rule that keeps the delay from growing. All of it is unit-tested.
 *
 * Wire protocol (TCP, big-endian), phone -> TV:
 *   "STCAST1\n", then one JSON line {name, pin?, token?, w, h, fps, audio}; the TV answers one JSON line {ok, token?, w?, h?} / {ok:false, error}.
 *   Then packets [type u8][ptsUs i64][len u32][payload]: 1 codec config (SPS+PPS), 2 delta frame, 3 key frame (both Annex-B),
 *   4 audio (PCM s16le 48 kHz stereo, 20 ms = 3840 bytes), 9 ping (empty). TV -> phone: 'K' (0x4B) send a key frame, 'Q' (0x51) stop.
 */
object Logic {
    const val MAGIC = "STCAST1"
    const val PORT = 8766
    const val SERVICE_TYPE = "_stashr-cast._tcp."
    const val T_CONFIG = 1
    const val T_DELTA = 2
    const val T_KEY = 3
    const val T_AUDIO = 4
    const val T_PING = 9
    const val MSG_KEY = 0x4B
    const val MSG_STOP = 0x51
    const val AUDIO_RATE = 48000
    const val AUDIO_CHUNK_BYTES = 3840          // 20 ms of stereo s16le at 48 kHz
    const val MAX_PAYLOAD = 8 * 1024 * 1024

    /** A packet read from the wire. */
    class Packet(val type: Int, val ptsUs: Long, val payload: ByteArray)

    fun writePacket(out: OutputStream, type: Int, ptsUs: Long, payload: ByteArray, off: Int = 0, len: Int = payload.size) {
        val d = DataOutputStream(out)
        d.writeByte(type); d.writeLong(ptsUs); d.writeInt(len)
        d.write(payload, off, len)
    }

    /** Reads one packet; null at a clean end of the stream. */
    fun readPacket(input: InputStream): Packet? {
        val d = DataInputStream(input)
        val type = try { d.readUnsignedByte() } catch (e: EOFException) { return null }
        val pts = d.readLong()
        val len = d.readInt()
        if (len < 0 || len > MAX_PAYLOAD) throw IOException("Bad packet length $len")
        val payload = ByteArray(len)
        d.readFully(payload)
        return Packet(type, pts, payload)
    }

    /** The first line the phone sends after the magic. */
    fun helloJson(name: String, pin: String?, token: String?, w: Int, h: Int, fps: Int, audio: Boolean): String {
        val o = JSONObject().put("name", name.take(60)).put("w", w).put("h", h).put("fps", fps).put("audio", audio)
        if (!token.isNullOrEmpty()) o.put("token", token) else if (!pin.isNullOrEmpty()) o.put("pin", pin)
        return o.toString()
    }

    class Reply(val ok: Boolean, val token: String?, val w: Int, val h: Int, val error: String) {
        /** The TV wants a (new) PIN: a wrong or missing PIN, or a token it does not know. */
        val needsPin get() = !ok && Regex("pin|token|not allowed|unauthori[sz]ed", RegexOption.IGNORE_CASE).containsMatchIn(error)
    }

    fun parseReply(line: String): Reply {
        val o = try { JSONObject(line.trim()) } catch (e: Exception) { return Reply(false, null, 0, 0, "The TV sent something that is not Stashr Cast") }
        val ok = o.optBoolean("ok")
        return Reply(ok, o.optString("token").ifEmpty { null }, o.optInt("w"), o.optInt("h"), if (ok) "" else o.optString("error", "The TV said no"))
    }

    /** The picture size to send: the phone's aspect ratio, long side <= 1920 and short side <= 1080, both even (H.264 needs it). */
    fun scaleTo(w: Int, h: Int, longMax: Int = 1920, shortMax: Int = 1080): Pair<Int, Int> {
        if (w <= 0 || h <= 0) return 2 to 2
        val long = maxOf(w, h); val short = minOf(w, h)
        val f = minOf(1.0, longMax.toDouble() / long, shortMax.toDouble() / short)
        fun even(v: Double) = maxOf(2, (v.toInt() / 2) * 2)
        return even(w * f) to even(h * f)
    }

    /** Smooth keeps 60 frames a second when the screen can; Sharp and Max use 30 and a higher bitrate. */
    class Quality(val key: String, val label: String, val bitrate: Int, val wantFps: Int)
    val QUALITIES = listOf(
        Quality("smooth", "Smooth", 6_000_000, 60),
        Quality("sharp", "Sharp", 10_000_000, 30),
        Quality("max", "Max", 16_000_000, 30)
    )
    fun qualityOf(key: String) = QUALITIES.firstOrNull { it.key == key } ?: QUALITIES[1]
    fun fpsFor(q: Quality, refreshRate: Float) = if (q.wantFps >= 60 && refreshRate >= 59f) 60 else 30

    /**
     * Keeps the delay from growing. Deltas are dropped when more than 4 packets (or ~250 ms of video) wait to be sent, and then
     * all deltas are dropped until a key frame has gone out. Key frames and codec config are always let through.
     */
    class Backpressure(private val bitrateBps: Int, private val maxPackets: Int = 4, private val maxMs: Int = 250) {
        @Volatile var needKey = false
            private set

        /** True: send it. False: drop it (the caller should then ask for a key frame). */
        fun admit(isKey: Boolean, queuedPackets: Int, queuedBytes: Int): Boolean {
            if (isKey) { needKey = false; return true }
            if (needKey) return false
            val queuedMs = queuedBytes.toLong() * 8 * 1000 / maxOf(bitrateBps, 1)
            if (queuedPackets > maxPackets || queuedMs > maxMs) { needKey = true; return false }
            return true
        }
    }

    /** Audio is dropped, never queued up: more than ~200 ms (10 chunks) waiting means the link is behind. */
    fun admitAudio(queuedPackets: Int) = queuedPackets <= 10

    /** "tv", "192.168.1.30" or "192.168.1.30:8766" -> host and port, or null. */
    fun parseAddress(text: String): Pair<String, Int>? {
        val t = text.trim().removePrefix("tcp://").trimEnd('/')
        if (t.isEmpty() || t.contains(' ')) return null
        val i = t.lastIndexOf(':')
        if (i < 0) return if (Regex("^[A-Za-z0-9.-]{1,100}$").matches(t)) t to PORT else null
        val host = t.substring(0, i); val port = t.substring(i + 1).toIntOrNull() ?: return null
        return if (Regex("^[A-Za-z0-9.-]{1,100}$").matches(host) && port in 1..65535) host to port else null
    }

    fun kbpsText(bytesPerSecond: Long): String = if (bytesPerSecond >= 125_000) "%.1f Mbit/s".format(bytesPerSecond * 8 / 1_000_000.0) else "${bytesPerSecond * 8 / 1000} kbit/s"
}

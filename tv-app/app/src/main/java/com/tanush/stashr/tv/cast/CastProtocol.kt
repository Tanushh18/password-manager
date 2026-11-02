package com.tanush.stashr.tv.cast

import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.security.SecureRandom
import org.json.JSONObject

/**
 * The wire format of Stashr Cast (the phone shows its screen on the TV). All numbers are big-endian, over one TCP connection:
 *   client → TV: the line "STCAST1\n", then one JSON line (name, pin?, token?, w, h, fps, audio), answered by one JSON line;
 *   then packets [type u8][ptsUs i64][len u32][payload]: 1 SPS+PPS (Annex-B), 2 delta frame, 3 key frame, 4 audio PCM s16le 48 kHz stereo, 9 ping.
 *   TV → client: single bytes 'K' (send a key frame) and 'Q' (stop).
 * Everything in this file is plain Kotlin so it can be unit-tested.
 */
object Cast {
    const val T_CONFIG = 1
    const val T_DELTA = 2
    const val T_KEY = 3
    const val T_AUDIO = 4
    const val T_PING = 9
    const val MAX_PAYLOAD = 4 * 1024 * 1024
    const val HELLO = "STCAST1"
    const val ASK_KEY = 0x4B
    const val STOP = 0x51
    const val SERVICE_TYPE = "_stashr-cast._tcp."
    val PORTS = 8766..8770
    const val IDLE_MS = 10_000L
    const val HEADER = 13
    val KNOWN = setOf(T_CONFIG, T_DELTA, T_KEY, T_AUDIO, T_PING)
}

class Packet(val type: Int, val ptsUs: Long, val payload: ByteArray)

object PacketIO {
    fun write(out: OutputStream, type: Int, ptsUs: Long, payload: ByteArray) {
        val h = ByteBuffer.allocate(Cast.HEADER).order(ByteOrder.BIG_ENDIAN).put(type.toByte()).putLong(ptsUs).putInt(payload.size)
        out.write(h.array()); if (payload.isNotEmpty()) out.write(payload); out.flush()
    }

    /** One packet, or null when the stream ended cleanly between packets. Reads whatever the network delivers in pieces. */
    fun read(input: InputStream): Packet? {
        val d = DataInputStream(input)
        val t = d.read()
        if (t < 0) return null
        if (t !in Cast.KNOWN) throw IOException("Unknown packet type $t")
        val pts = try { d.readLong() } catch (e: EOFException) { throw IOException("Cut off in a packet header") }
        val len = d.readInt()
        if (len < 0 || len > Cast.MAX_PAYLOAD) throw IOException("Packet too big: $len")
        val data = ByteArray(len)
        try { d.readFully(data) } catch (e: EOFException) { throw IOException("Cut off in a packet") }
        return Packet(t, pts, data)
    }
}

data class Hello(val name: String, val pin: String?, val token: String?, val w: Int, val h: Int, val fps: Int, val audio: Boolean)

object Handshake {
    /** A line ended by \n, at most [max] bytes (without the newline). null: the stream ended, or the line was too long. */
    fun readLine(input: InputStream, max: Int = 2048): String? {
        val sb = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return null
            if (b == '\n'.code) return sb.toString(Charsets.UTF_8.name()).trimEnd('\r')
            if (sb.size() >= max) return null
            sb.write(b)
        }
    }

    private val HEX = Regex("^[0-9a-f]{32}$")
    private val PIN = Regex("^[0-9]{4}$")

    /** Checks and cleans what the phone says about itself. null: not acceptable. */
    fun parseHello(line: String): Hello? = try {
        val j = JSONObject(line)
        val name = j.optString("name", "Phone").filter { it >= ' ' && it != '\u007f' }.trim().take(40).ifEmpty { "Phone" }
        val pin = j.optString("pin", "").takeIf { PIN.matches(it) }
        val token = j.optString("token", "").lowercase().takeIf { HEX.matches(it) }
        val w = j.optInt("w", 1280); val h = j.optInt("h", 720)
        val fps = j.optInt("fps", 30)
        if (w !in 16..8192 || h !in 16..8192 || fps !in 1..120) null
        else Hello(name, pin, token, w, h, fps, j.optBoolean("audio", false))
    } catch (e: Exception) { null }

    fun ok(token: String?) = JSONObject().put("ok", true).apply { if (token != null) put("token", token) }.toString() + "\n"
    fun error(message: String) = JSONObject().put("ok", false).put("error", message).toString() + "\n"
}

data class CastToken(val token: String, val name: String, val at: Long)

/** The phones that may mirror without typing the PIN again. */
object Tokens {
    const val MAX = 10

    fun parse(json: String): List<CastToken> = try {
        val a = org.json.JSONArray(json.ifBlank { "[]" })
        (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { CastToken(it.optString("token"), it.optString("name"), it.optLong("at")) } }.filter { it.token.length == 32 }
    } catch (e: Exception) { emptyList() }

    fun toJson(list: List<CastToken>): String =
        org.json.JSONArray().apply { list.forEach { put(JSONObject().put("token", it.token).put("name", it.name).put("at", it.at)) } }.toString()

    /** Newest first; a phone with the same name replaces its old entry; at most [MAX]. */
    fun add(list: List<CastToken>, t: CastToken): List<CastToken> = (listOf(t) + list.filter { it.name != t.name && it.token != t.token }).take(MAX)

    fun find(list: List<CastToken>, token: String): CastToken? {
        var hit: CastToken? = null
        for (t in list) if (MessageDigest.isEqual(t.token.toByteArray(), token.toByteArray())) hit = t   // no early exit
        return hit
    }

    fun forget(list: List<CastToken>, token: String) = list.filter { it.token != token }

    fun newToken(rnd: SecureRandom = SecureRandom()): String = ByteArray(16).also { rnd.nextBytes(it) }.joinToString("") { "%02x".format(it) }
}

/** 5 wrong PINs from one address within 10 minutes block that address for 10 minutes. */
class PinGuard(private val maxFails: Int = 5, private val windowMs: Long = 10 * 60_000L, private val blockMs: Long = 10 * 60_000L) {
    private val fails = HashMap<String, MutableList<Long>>()
    private val blockedUntil = HashMap<String, Long>()

    @Synchronized fun isBlocked(addr: String, now: Long): Boolean = (blockedUntil[addr] ?: 0L) > now

    @Synchronized fun fail(addr: String, now: Long) {
        val list = fails.getOrPut(addr) { mutableListOf() }
        list.removeAll { now - it > windowMs }
        list.add(now)
        if (list.size >= maxFails) { blockedUntil[addr] = now + blockMs; list.clear() }
        if (fails.size > 200) fails.keys.firstOrNull()?.let { fails.remove(it) }
    }

    @Synchronized fun success(addr: String) { fails.remove(addr) }
}

object Pin {
    const val LIFETIME_MS = 24 * 3600_000L
    fun generate(rnd: SecureRandom = SecureRandom()): String = "%04d".format(rnd.nextInt(10000))
    fun needsNew(generatedAt: Long, now: Long) = generatedAt <= 0 || now - generatedAt > LIFETIME_MS || now < generatedAt
    fun matches(expected: String, given: String?): Boolean = given != null && MessageDigest.isEqual(expected.toByteArray(), given.toByteArray())
}

/** The small decisions of the receiver, kept pure. */
object CastLogic {
    /** More frames than this waiting inside the decoder means the picture is running late. */
    const val MAX_IN_FLIGHT = 4
    const val MAX_AUDIO_BACKLOG_MS = 150

    fun isStale(inFlight: Int) = inFlight > MAX_IN_FLIGHT

    /** A delta frame is useless while we wait for a key frame; and nothing can be queued without a free decoder input. */
    fun accept(waitingForKey: Boolean, isKey: Boolean, inputAvailable: Boolean) = inputAvailable && (!waitingForKey || isKey)

    fun dropAudio(backlogFrames: Long, rate: Int = 48000, maxMs: Int = MAX_AUDIO_BACKLOG_MS) = backlogFrames * 1000 / rate > maxMs

    fun busy(hasSession: Boolean, lastPacketAt: Long, now: Long) = hasSession && now - lastPacketAt < Cast.IDLE_MS

    fun mayAskKey(lastAskAt: Long, now: Long) = now - lastAskAt >= 1000

    /** The NAL units of an Annex-B buffer, each with its start code. */
    fun splitAnnexB(data: ByteArray): List<ByteArray> {
        val starts = ArrayList<Int>()
        var i = 0
        while (i + 3 <= data.size) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) { starts.add(if (i > 0 && data[i - 1].toInt() == 0) i - 1 else i); i += 3 } else i++
        }
        if (starts.isEmpty()) return if (data.isEmpty()) emptyList() else listOf(data)
        return starts.mapIndexed { k, s -> data.copyOfRange(s, if (k + 1 < starts.size) starts[k + 1] else data.size) }
    }

    fun nalType(nal: ByteArray): Int {
        val off = if (nal.size > 4 && nal[2].toInt() == 0) 4 else 3
        return if (nal.size > off) nal[off].toInt() and 0x1F else -1
    }
}

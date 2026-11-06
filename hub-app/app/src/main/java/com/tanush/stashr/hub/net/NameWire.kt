package com.tanush.stashr.hub.net

import java.io.ByteArrayOutputStream

/**
 * The bytes on the wire for finding a device's own name: a DNS / mDNS reverse (PTR) query and its answer, and a
 * NetBIOS node status query and its answer. Pure Kotlin, no Android, so it is unit tested.
 */
object NameWire {
    const val TYPE_PTR = 12
    const val CLASS_IN = 1
    private const val UNICAST_RESPONSE = 0x8000

    /** "192.168.1.20" -> "20.1.168.192.in-addr.arpa". */
    fun reverseName(ip: String): String = ip.trim().split(".").reversed().joinToString(".") + ".in-addr.arpa"

    /**
     * A DNS query for the PTR record of an IPv4 address. With mdns = true the transaction id is 0 and the question asks
     * for a unicast answer (the QU bit), so the device replies straight to us instead of to the whole network.
     */
    fun ptrQuery(ip: String, id: Int, mdns: Boolean = false): ByteArray {
        val out = ByteArrayOutputStream()
        fun u16(v: Int) { out.write((v shr 8) and 0xff); out.write(v and 0xff) }
        u16(if (mdns) 0 else id and 0xffff)
        u16(if (mdns) 0 else 0x0100)          // flags: recursion desired for a normal DNS server
        u16(1); u16(0); u16(0); u16(0)        // one question
        for (label in reverseName(ip).split(".")) {
            val b = label.toByteArray(Charsets.US_ASCII)
            out.write(b.size); out.write(b)
        }
        out.write(0)
        u16(TYPE_PTR)
        u16(CLASS_IN or (if (mdns) UNICAST_RESPONSE else 0))
        return out.toByteArray()
    }

    /** Reads a (possibly compressed) DNS name at offset. Returns the name and the offset just after it in place. */
    fun readName(buf: ByteArray, start: Int): Pair<String, Int> {
        val labels = ArrayList<String>()
        var pos = start
        var end = -1
        var jumps = 0
        while (pos < buf.size) {
            val len = buf[pos].toInt() and 0xff
            if (len == 0) { pos += 1; break }
            if (len and 0xc0 == 0xc0) {
                if (pos + 1 >= buf.size || ++jumps > 20) throw IllegalArgumentException("bad name pointer")
                val target = ((len and 0x3f) shl 8) or (buf[pos + 1].toInt() and 0xff)
                if (end < 0) end = pos + 2
                pos = target
                continue
            }
            if (pos + 1 + len > buf.size) throw IllegalArgumentException("name runs past the packet")
            labels.add(String(buf, pos + 1, len, Charsets.UTF_8))
            pos += 1 + len
        }
        return labels.joinToString(".") to (if (end >= 0) end else pos)
    }

    private fun u16(buf: ByteArray, at: Int) = ((buf[at].toInt() and 0xff) shl 8) or (buf[at + 1].toInt() and 0xff)

    /**
     * The first PTR answer's target name in a DNS or mDNS response, or null. When expectId is given (plain DNS) the
     * transaction id must match.
     */
    fun parsePtrAnswer(buf: ByteArray, expectId: Int? = null): String? {
        try {
            if (buf.size < 12) return null
            if (expectId != null && u16(buf, 0) != (expectId and 0xffff)) return null
            val flags = u16(buf, 2)
            if (flags and 0x8000 == 0) return null          // not a response
            if (flags and 0x000f != 0) return null          // an error (e.g. NXDOMAIN)
            val qd = u16(buf, 4); val an = u16(buf, 6) + u16(buf, 8) + u16(buf, 10)
            var pos = 12
            repeat(qd) { pos = readName(buf, pos).second + 4 }
            repeat(an) {
                val (_, afterName) = readName(buf, pos)
                pos = afterName
                if (pos + 10 > buf.size) return null
                val type = u16(buf, pos); val rdLen = u16(buf, pos + 8)
                pos += 10
                if (type == TYPE_PTR) return readName(buf, pos).first.ifBlank { null }
                pos += rdLen
            }
        } catch (e: Exception) { return null }
        return null
    }

    /** A NetBIOS node status request for "*" (asks a Windows PC, or a Samba box, for its names). */
    fun netbiosQuery(id: Int): ByteArray {
        val out = ByteArrayOutputStream()
        fun u16(v: Int) { out.write((v shr 8) and 0xff); out.write(v and 0xff) }
        u16(id and 0xffff); u16(0); u16(1); u16(0); u16(0); u16(0)
        // "*" padded with zero bytes to 16, first-level encoded: each nibble + 'A'.
        val name = ByteArray(16).also { it[0] = '*'.code.toByte() }
        out.write(32)
        for (b in name) { val v = b.toInt() and 0xff; out.write('A'.code + (v shr 4)); out.write('A'.code + (v and 0x0f)) }
        out.write(0)
        u16(0x21)   // NBSTAT
        u16(1)      // IN
        return out.toByteArray()
    }

    /** The computer name from a node status answer: the first unique name of type 0x00 (the workstation), or null. */
    fun parseNetbiosAnswer(buf: ByteArray, expectId: Int? = null): String? {
        try {
            if (buf.size < 57) return null
            if (expectId != null && u16(buf, 0) != (expectId and 0xffff)) return null
            if (u16(buf, 2) and 0x8000 == 0) return null
            var pos = 12
            pos = readName(buf, pos).second       // the question name echoed back
            pos += 2 + 2 + 4 + 2                   // type, class, ttl, rdlength
            if (pos >= buf.size) return null
            val count = buf[pos].toInt() and 0xff
            pos += 1
            var fallback: String? = null
            for (i in 0 until count) {
                if (pos + 18 > buf.size) break
                val raw = String(buf, pos, 15, Charsets.US_ASCII).trim { it <= ' ' }
                val suffix = buf[pos + 15].toInt() and 0xff
                val group = (buf[pos + 16].toInt() and 0x80) != 0
                pos += 18
                if (raw.isEmpty() || raw.startsWith("\u0001")) continue
                if (suffix == 0x00 && !group) return raw
                if (fallback == null && !group) fallback = raw
            }
            return fallback
        } catch (e: Exception) { return null }
    }

    /** "Johns-iPhone.local." -> "Johns-iPhone", "router.lan" -> "router"; numeric reverse names are not names. */
    fun cleanName(raw: String?): String {
        var n = (raw ?: "").trim().trimEnd('.')
        if (n.isEmpty() || n.endsWith(".in-addr.arpa", true)) return ""
        for (suffix in listOf(".local", ".lan", ".home", ".localdomain", ".home.arpa", ".router")) {
            if (n.endsWith(suffix, ignoreCase = true)) n = n.dropLast(suffix.length)
        }
        if (Regex("^\\d{1,3}([.-]\\d{1,3}){3}$").matches(n)) return ""
        return n.take(80)
    }
}

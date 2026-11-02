package com.tanush.stashr.hub

import com.tanush.stashr.hub.net.NameWire
import com.tanush.stashr.hub.net.WakeOnLan
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

class NameWireTest {
    private fun u16(o: ByteArrayOutputStream, v: Int) { o.write((v shr 8) and 0xff); o.write(v and 0xff) }
    private fun name(o: ByteArrayOutputStream, n: String) { for (l in n.split(".")) { val b = l.toByteArray(); o.write(b.size); o.write(b) }; o.write(0) }

    @Test fun reverseName() = assertEquals("20.1.168.192.in-addr.arpa", NameWire.reverseName("192.168.1.20"))

    @Test fun ptrQueryLayout() {
        val q = NameWire.ptrQuery("192.168.1.20", 0x1234)
        assertEquals(0x12, q[0].toInt() and 0xff); assertEquals(0x34, q[1].toInt() and 0xff)
        assertEquals(1, q[5].toInt())                                   // one question
        assertEquals("20.1.168.192.in-addr.arpa", NameWire.readName(q, 12).first)
        val n = q.size
        assertEquals(12, q[n - 3].toInt()); assertEquals(1, q[n - 1].toInt())   // PTR, IN
        val m = NameWire.ptrQuery("192.168.1.20", 99, mdns = true)
        assertEquals(0, m[0].toInt()); assertEquals(0x80, m[m.size - 2].toInt() and 0xff)  // id 0, QU bit
    }

    /** A real-shaped answer: the question, then a PTR answer whose name points back at the question (compression). */
    private fun answer(id: Int, target: String, rcode: Int = 0): ByteArray {
        val o = ByteArrayOutputStream()
        u16(o, id); u16(o, 0x8180 or rcode); u16(o, 1); u16(o, 1); u16(o, 0); u16(o, 0)
        name(o, "20.1.168.192.in-addr.arpa"); u16(o, 12); u16(o, 1)
        o.write(0xc0); o.write(12); u16(o, 12); u16(o, 1); u16(o, 0); u16(o, 60)
        val rd = ByteArrayOutputStream().also { name(it, target) }.toByteArray()
        u16(o, rd.size); o.write(rd)
        return o.toByteArray()
    }

    @Test fun parsesPtrAnswer() {
        assertEquals("Galaxy-S23.lan", NameWire.parsePtrAnswer(answer(7, "Galaxy-S23.lan"), 7))
        assertNull(NameWire.parsePtrAnswer(answer(7, "x.lan"), 8))            // wrong id
        assertNull(NameWire.parsePtrAnswer(answer(7, "x.lan", rcode = 3), 7)) // NXDOMAIN
        assertNull(NameWire.parsePtrAnswer(byteArrayOf(1, 2, 3)))
    }

    @Test fun cleansNames() {
        assertEquals("Johns-iPhone", NameWire.cleanName("Johns-iPhone.local."))
        assertEquals("Galaxy-S23", NameWire.cleanName("Galaxy-S23.lan"))
        assertEquals("", NameWire.cleanName("20.1.168.192.in-addr.arpa"))
        assertEquals("", NameWire.cleanName("192-168-1-20"))
        assertEquals("", NameWire.cleanName(null))
    }

    @Test fun netbiosQueryAndAnswer() {
        val q = NameWire.netbiosQuery(0x0102)
        assertEquals(32, q[12].toInt())
        assertEquals('C'.code, q[13].toInt()); assertEquals('K'.code, q[14].toInt())  // '*' = 0x2A -> "CK"
        val o = ByteArrayOutputStream()
        u16(o, 0x0102); u16(o, 0x8400); u16(o, 0); u16(o, 1); u16(o, 0); u16(o, 0)
        o.write(q, 12, 34)                    // the encoded name echoed back
        u16(o, 0x21); u16(o, 1); u16(o, 0); u16(o, 0); u16(o, 1 + 2 * 18)
        o.write(2)
        fun entry(n: String, suffix: Int, flags: Int) { o.write(n.padEnd(15).toByteArray()); o.write(suffix); u16(o, flags) }
        entry("WORKGROUP", 0x00, 0x8400)      // a group name: skipped
        entry("GAMING-PC", 0x00, 0x0400)
        assertEquals("GAMING-PC", NameWire.parseNetbiosAnswer(o.toByteArray(), 0x0102))
        assertNull(NameWire.parseNetbiosAnswer(o.toByteArray(), 0x0999))
    }

    @Test fun wakeOnLanPacket() {
        val mac = WakeOnLan.parseMac("AA-bb-cc-dd-ee-ff")
        val p = WakeOnLan.magicPacket(mac)
        assertEquals(102, p.size)
        assertArrayEquals(ByteArray(6) { 0xff.toByte() }, p.copyOfRange(0, 6))
        assertArrayEquals(mac, p.copyOfRange(96, 102))
    }

    @Test(expected = IllegalArgumentException::class) fun badMac() { WakeOnLan.parseMac("nope") }
}

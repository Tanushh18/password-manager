package com.tanush.stashr.tv

import com.tanush.stashr.tv.cast.Cast
import com.tanush.stashr.tv.cast.CastLogic
import com.tanush.stashr.tv.cast.CastToken
import com.tanush.stashr.tv.cast.Handshake
import com.tanush.stashr.tv.cast.PacketIO
import com.tanush.stashr.tv.cast.Pin
import com.tanush.stashr.tv.cast.PinGuard
import com.tanush.stashr.tv.cast.Tokens
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

class CastTest {
    /** An input that hands out one byte at a time, like a slow Wi-Fi. */
    private class Drip(private val data: ByteArray) : InputStream() {
        private var i = 0
        override fun read(): Int = if (i < data.size) data[i++].toInt() and 0xFF else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int { if (i >= data.size) return -1; b[off] = data[i++]; return 1 }
    }

    @Test fun packetsRoundTripEvenWhenTheyArriveInPieces() {
        val out = ByteArrayOutputStream()
        PacketIO.write(out, Cast.T_CONFIG, 0, byteArrayOf(0, 0, 0, 1, 0x67, 1, 2))
        PacketIO.write(out, Cast.T_KEY, 1_234_567_890_123L, ByteArray(100_000) { (it % 251).toByte() })
        PacketIO.write(out, Cast.T_PING, -5, ByteArray(0))
        val input = Drip(out.toByteArray())
        val a = PacketIO.read(input)!!
        assertEquals(Cast.T_CONFIG, a.type); assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x67, 1, 2), a.payload)
        val b = PacketIO.read(input)!!
        assertEquals(Cast.T_KEY, b.type); assertEquals(1_234_567_890_123L, b.ptsUs); assertEquals(100_000, b.payload.size); assertEquals(((99_999) % 251).toByte(), b.payload[99_999])
        val c = PacketIO.read(input)!!
        assertEquals(Cast.T_PING, c.type); assertEquals(-5L, c.ptsUs); assertEquals(0, c.payload.size)
        assertNull(PacketIO.read(input))                       // a clean end between packets
    }

    @Test fun badPacketsAreRefused() {
        fun header(type: Int, len: Int) = byteArrayOf(type.toByte(), 0, 0, 0, 0, 0, 0, 0, 0, (len shr 24).toByte(), (len shr 16).toByte(), (len shr 8).toByte(), len.toByte())
        try { PacketIO.read(ByteArrayInputStream(header(7, 1) + byteArrayOf(0))); org.junit.Assert.fail() } catch (e: IOException) { /* unknown type */ }
        try { PacketIO.read(ByteArrayInputStream(header(Cast.T_KEY, Cast.MAX_PAYLOAD + 1))); org.junit.Assert.fail() } catch (e: IOException) { /* too big */ }
        try { PacketIO.read(ByteArrayInputStream(header(Cast.T_KEY, 50) + ByteArray(10))); org.junit.Assert.fail() } catch (e: IOException) { /* cut off */ }
        try { PacketIO.read(ByteArrayInputStream(header(Cast.T_KEY, -1))); org.junit.Assert.fail() } catch (e: IOException) { /* negative */ }
    }

    @Test fun theHelloLineIsReadAndChecked() {
        assertEquals("STCAST1", Handshake.readLine(ByteArrayInputStream("STCAST1\r\nrest".toByteArray())))
        assertNull(Handshake.readLine(ByteArrayInputStream(ByteArray(3000) { 'a'.code.toByte() } + "\n".toByteArray()), 2048))   // too long
        assertNull(Handshake.readLine(ByteArrayInputStream("no newline".toByteArray())))
        val h = Handshake.parseHello("""{"name":"Pixel 8","pin":"1234","w":1080,"h":2400,"fps":60,"audio":true}""")!!
        assertEquals("Pixel 8", h.name); assertEquals("1234", h.pin); assertNull(h.token); assertEquals(60, h.fps); assertTrue(h.audio)
        val t = Handshake.parseHello("""{"name":"Ana\u0007","token":"AABBCCDDEEFF00112233445566778899","w":1280,"h":720,"fps":30}""")!!
        assertEquals("Ana", t.name); assertEquals("aabbccddeeff00112233445566778899", t.token); assertFalse(t.audio)
        assertNull(Handshake.parseHello("""{"name":"x","w":10,"h":720,"fps":30}"""))        // too small
        assertNull(Handshake.parseHello("""{"name":"x","w":1280,"h":720,"fps":500}"""))     // too fast
        assertNull(Handshake.parseHello("not json"))
        assertNull(Handshake.parseHello("""{"w":1280,"h":720,"pin":"12"}""")!!.pin)         // a PIN of the wrong shape is ignored
    }

    @Test fun fiveWrongPinsBlockTheAddressForTenMinutes() {
        val g = PinGuard()
        val t0 = 1_000_000L
        for (i in 0 until 4) { g.fail("10.0.0.5", t0 + i * 1000); assertFalse(g.isBlocked("10.0.0.5", t0 + i * 1000 + 1)) }
        g.fail("10.0.0.5", t0 + 5000)
        assertTrue(g.isBlocked("10.0.0.5", t0 + 6000))
        assertFalse(g.isBlocked("10.0.0.6", t0 + 6000))                        // another phone is not affected
        assertTrue(g.isBlocked("10.0.0.5", t0 + 5000 + 9 * 60_000))
        assertFalse(g.isBlocked("10.0.0.5", t0 + 5000 + 10 * 60_000 + 1))
        // failures older than the window do not add up
        val g2 = PinGuard()
        for (i in 0 until 4) g2.fail("a", t0)
        g2.fail("a", t0 + 11 * 60_000)
        assertFalse(g2.isBlocked("a", t0 + 11 * 60_000 + 1))
    }

    @Test fun pinRules() {
        assertTrue(Pin.generate().matches(Regex("^[0-9]{4}$")))
        assertTrue(Pin.needsNew(0, 100)); assertFalse(Pin.needsNew(1000, 1000 + 3600_000)); assertTrue(Pin.needsNew(1000, 1000 + Pin.LIFETIME_MS + 1))
        assertTrue(Pin.matches("0042", "0042")); assertFalse(Pin.matches("0042", "0043")); assertFalse(Pin.matches("0042", null))
    }

    @Test fun rememberedPhonesAreLimitedAndCanBeForgotten() {
        var list = emptyList<CastToken>()
        for (i in 1..14) list = Tokens.add(list, CastToken("%032x".format(i), "Phone $i", i.toLong()))
        assertEquals(Tokens.MAX, list.size)
        assertEquals("Phone 14", list.first().name)                            // newest first
        assertNull(Tokens.find(list, "%032x".format(1)))                       // the oldest fell off
        assertNotNull(Tokens.find(list, "%032x".format(14)))
        list = Tokens.add(list, CastToken("%032x".format(99), "Phone 14", 99))  // same name: replaced, not doubled
        assertEquals(Tokens.MAX, list.size); assertEquals(1, list.count { it.name == "Phone 14" })
        assertEquals(Tokens.MAX - 1, Tokens.forget(list, "%032x".format(99)).size)
        val back = Tokens.parse(Tokens.toJson(list))
        assertEquals(list, back)
        assertTrue(Tokens.parse("garbage").isEmpty())
        assertEquals(32, Tokens.newToken().length)
    }

    @Test fun staleFramesAndLateSoundAreDropped() {
        assertFalse(CastLogic.isStale(4)); assertTrue(CastLogic.isStale(5))
        assertFalse(CastLogic.accept(waitingForKey = true, isKey = false, inputAvailable = true))   // a delta frame is useless before a key frame
        assertTrue(CastLogic.accept(true, true, true)); assertTrue(CastLogic.accept(false, false, true))
        assertFalse(CastLogic.accept(false, true, false))                                           // no free decoder input
        assertFalse(CastLogic.dropAudio(48000L * 100 / 1000)); assertTrue(CastLogic.dropAudio(48000L * 200 / 1000))
        assertTrue(CastLogic.busy(true, 1000, 5000)); assertFalse(CastLogic.busy(true, 1000, 12_000)); assertFalse(CastLogic.busy(false, 1000, 1500))
        assertFalse(CastLogic.mayAskKey(1000, 1500)); assertTrue(CastLogic.mayAskKey(1000, 2000))
    }

    @Test fun annexBIsSplitIntoNals() {
        val sps = byteArrayOf(0, 0, 0, 1, 0x67, 0x64, 0, 0x28)
        val pps = byteArrayOf(0, 0, 1, 0x68, 0xEE.toByte(), 0x3C)
        val nals = CastLogic.splitAnnexB(sps + pps)
        assertEquals(2, nals.size)
        assertArrayEquals(sps, nals[0]); assertArrayEquals(pps, nals[1])
        assertEquals(7, CastLogic.nalType(nals[0])); assertEquals(8, CastLogic.nalType(nals[1]))
        assertEquals(1, CastLogic.splitAnnexB(byteArrayOf(1, 2, 3)).size)
        assertTrue(CastLogic.splitAnnexB(ByteArray(0)).isEmpty())
    }
}

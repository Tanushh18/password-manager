package com.tanush.stashr.cast

import com.tanush.stashr.cast.core.Logic
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

class LogicTest {
    @Test fun packetsSurviveTheWire() {
        val out = ByteArrayOutputStream()
        Logic.writePacket(out, Logic.T_CONFIG, 7L, byteArrayOf(0, 0, 0, 1, 0x67, 1, 2))
        Logic.writePacket(out, Logic.T_KEY, 1_000_000L, ByteArray(5000) { (it % 251).toByte() })
        Logic.writePacket(out, Logic.T_PING, -1L, ByteArray(0))
        val input = ByteArrayInputStream(out.toByteArray())
        val a = Logic.readPacket(input)!!
        assertEquals(Logic.T_CONFIG, a.type); assertEquals(7L, a.ptsUs); assertArrayEquals(byteArrayOf(0, 0, 0, 1, 0x67, 1, 2), a.payload)
        val b = Logic.readPacket(input)!!
        assertEquals(Logic.T_KEY, b.type); assertEquals(1_000_000L, b.ptsUs); assertEquals(5000, b.payload.size); assertEquals((4999 % 251).toByte(), b.payload[4999])
        val c = Logic.readPacket(input)!!
        assertEquals(Logic.T_PING, c.type); assertEquals(-1L, c.ptsUs); assertEquals(0, c.payload.size)
        assertNull(Logic.readPacket(input))       // clean end
    }

    @Test fun headerIsThirteenBytesBigEndian() {
        val out = ByteArrayOutputStream()
        Logic.writePacket(out, 3, 0x0102030405060708L, byteArrayOf(9, 9))
        val b = out.toByteArray()
        assertEquals(13 + 2, b.size)
        assertEquals(3, b[0].toInt())
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8), b.copyOfRange(1, 9))
        assertArrayEquals(byteArrayOf(0, 0, 0, 2), b.copyOfRange(9, 13))
    }

    @Test fun absurdLengthsAreRefused() {
        val bad = byteArrayOf(2, 0, 0, 0, 0, 0, 0, 0, 0, 0x7F, 0, 0, 0)
        try { Logic.readPacket(ByteArrayInputStream(bad)); throw AssertionError("should have failed") } catch (e: IOException) { assertTrue(e.message!!.contains("Bad packet length")) }
    }

    @Test fun helloCarriesTheTokenOrThePin() {
        val first = JSONObject(Logic.helloJson("Pixel 8", "1234", null, 864, 1920, 60, true))
        assertEquals("Pixel 8", first.getString("name")); assertEquals("1234", first.getString("pin")); assertFalse(first.has("token"))
        assertEquals(864, first.getInt("w")); assertEquals(1920, first.getInt("h")); assertEquals(60, first.getInt("fps")); assertTrue(first.getBoolean("audio"))
        val again = JSONObject(Logic.helloJson("Pixel 8", "1234", "abcdef", 864, 1920, 30, false))
        assertEquals("abcdef", again.getString("token")); assertFalse(again.has("pin")); assertFalse(again.getBoolean("audio"))
    }

    @Test fun repliesAreRead() {
        val ok = Logic.parseReply("""{"ok":true,"token":"t0k","w":1920,"h":1080}""")
        assertTrue(ok.ok); assertEquals("t0k", ok.token); assertEquals(1920, ok.w); assertFalse(ok.needsPin)
        val pin = Logic.parseReply("""{"ok":false,"error":"Wrong PIN"}""")
        assertFalse(pin.ok); assertEquals("Wrong PIN", pin.error); assertTrue(pin.needsPin)
        val busy = Logic.parseReply("""{"ok":false,"error":"TV is busy"}""")
        assertFalse(busy.needsPin); assertEquals("TV is busy", busy.error)
        assertTrue(Logic.parseReply("""{"ok":false,"error":"Unknown token"}""").needsPin)
        val junk = Logic.parseReply("hello")
        assertFalse(junk.ok); assertNotNull(junk.error)
    }

    @Test fun pictureSizeIsEvenAndFitsFullHd() {
        assertEquals(1080 to 1920, Logic.scaleTo(1080, 1920))
        assertEquals(864 to 1920, Logic.scaleTo(1080, 2400))          // tall phone: long side 2400 -> 1920
        assertEquals(1920 to 864, Logic.scaleTo(2400, 1080))          // the same turned
        assertEquals(1920 to 1080, Logic.scaleTo(3840, 2160))
        assertEquals(720 to 1280, Logic.scaleTo(720, 1280))           // already small: unchanged
        val (w, h) = Logic.scaleTo(1441, 3201)
        assertTrue(w % 2 == 0 && h % 2 == 0 && maxOf(w, h) <= 1920 && minOf(w, h) <= 1080)
        assertEquals(2 to 2, Logic.scaleTo(0, 0))
    }

    @Test fun smoothNeedsASixtyHertzScreen() {
        assertEquals(60, Logic.fpsFor(Logic.qualityOf("smooth"), 60f))
        assertEquals(60, Logic.fpsFor(Logic.qualityOf("smooth"), 120f))
        assertEquals(30, Logic.fpsFor(Logic.qualityOf("smooth"), 30f))
        assertEquals(30, Logic.fpsFor(Logic.qualityOf("sharp"), 60f))
        assertEquals(6_000_000, Logic.qualityOf("smooth").bitrate); assertEquals(10_000_000, Logic.qualityOf("sharp").bitrate); assertEquals(16_000_000, Logic.qualityOf("max").bitrate)
        assertEquals("sharp", Logic.qualityOf("nonsense").key)
    }

    @Test fun backpressureDropsDeltasUntilTheNextKeyFrame() {
        val bp = Logic.Backpressure(10_000_000)
        assertTrue(bp.admit(false, 0, 0))
        assertTrue(bp.admit(false, 4, 10_000))                       // 4 waiting is still fine
        assertFalse(bp.admit(false, 5, 10_000))                      // 5 waiting: drop, and wait for a key frame
        assertTrue(bp.needKey)
        assertFalse(bp.admit(false, 0, 0))                           // even with an empty queue, deltas stay dropped
        assertTrue(bp.admit(true, 9, 1_000_000))                     // a key frame always goes, and ends the dropping
        assertFalse(bp.needKey)
        assertTrue(bp.admit(false, 1, 1000))
    }

    @Test fun backpressureWatchesTheTimeNotJustTheCount() {
        val bp = Logic.Backpressure(10_000_000)                       // 10 Mbit/s = 1.25 MB/s -> 250 ms is ~312 KB
        assertTrue(bp.admit(false, 2, 300_000))
        assertFalse(bp.admit(false, 2, 320_000))
        val slow = Logic.Backpressure(2_000_000)
        assertFalse(slow.admit(false, 1, 70_000))                    // the same bytes are a longer delay on a thin stream
    }

    @Test fun audioIsDroppedNotQueued() {
        assertTrue(Logic.admitAudio(10)); assertFalse(Logic.admitAudio(11))
    }

    @Test fun addressesAreParsed() {
        assertEquals("192.168.1.30" to 8766, Logic.parseAddress("192.168.1.30"))
        assertEquals("192.168.1.30" to 9000, Logic.parseAddress(" 192.168.1.30:9000 "))
        assertEquals("living-room.local" to 8766, Logic.parseAddress("living-room.local"))
        assertNull(Logic.parseAddress("")); assertNull(Logic.parseAddress("a b")); assertNull(Logic.parseAddress("host:99999")); assertNull(Logic.parseAddress("host:abc"))
    }

    @Test fun rateIsShownInTheRightUnit() {
        assertEquals("8.0 Mbit/s", Logic.kbpsText(1_000_000)); assertEquals("80 kbit/s", Logic.kbpsText(10_000))
    }
}

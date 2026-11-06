package com.tanush.stashr.hub

import com.tanush.stashr.hub.core.WifiProbeLogic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class WifiProbeTest {
    private val perMinute = 240            // 4 readings a second

    /** A still room: the signal sits around [base] and wobbles by about [noise] dB. */
    private fun still(rnd: Random, base: Int = -50, noise: Double = 0.7, n: Int = perMinute) = List(n) { (base + rnd.nextGaussian() * noise).toInt() }

    /** Somebody walking through the line between tablet and router: the signal dips by [dip] dB for a few seconds, over and over. */
    private fun walking(rnd: Random, dip: Double, n: Int = perMinute): List<Int> {
        val out = still(rnd, n = n).toMutableList()
        var i = 0
        while (i < n) { val len = 6 + rnd.nextInt(10); for (k in i until minOf(n, i + len)) out[k] -= (dip * (0.6 + 0.4 * rnd.nextDouble())).toInt(); i += len + 10 + rnd.nextInt(30) }
        return out
    }

    @Test fun clearDipsWhileWalkingAreSeen() {
        val rnd = Random(1)
        val r = WifiProbeLogic.evaluate(still(rnd), walking(rnd, 6.0))
        assertEquals("USABLE", r.verdict)
        assertTrue(r.hit >= 70); assertTrue(r.falseAlarm <= 15)
    }

    @Test fun noChangeWhenWalkingMeansNotUsable() {
        val rnd = Random(2)
        val r = WifiProbeLogic.evaluate(still(rnd), still(rnd))              // nobody's walk changes anything
        assertEquals("NOT_USABLE", r.verdict)
        assertTrue(r.hit < 45)
    }

    @Test fun aReadingThatBarelyUpdatesCannotSeeAnything() {
        val slow = List(perMinute) { -50 - (it / 40) % 2 }                      // changes about 6 times a minute
        val r = WifiProbeLogic.evaluate(slow, slow)
        assertEquals("TOO_FEW_UPDATES", r.verdict)
        assertTrue(WifiProbeLogic.text(r, "2.4 GHz").startsWith("Wi-Fi motion test: TOO_FEW_UPDATES"))
    }

    @Test fun statsAndWindows() {
        val s = WifiProbeLogic.stats(listOf(-50, -50, -52, -52, -50))
        assertEquals(5, s.n); assertEquals(2, s.updates); assertEquals(-52, s.min); assertEquals(-50, s.max)
        assertEquals(2, WifiProbeLogic.windowStds(List(60) { -50 }).size)          // 60 samples = two full windows of 24
        assertEquals(0.0, WifiProbeLogic.windowStds(List(24) { -50 })[0], 0.0001)
    }

    @Test fun theLineStaysShortEnoughForTheServer() {
        val rnd = Random(3)
        val line = WifiProbeLogic.text(WifiProbeLogic.evaluate(still(rnd), walking(rnd, 6.0)), "5 GHz")
        assertTrue(line.length <= 200)
        assertTrue(line.contains("false alarms"))
    }
}

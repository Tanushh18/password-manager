package com.tanush.stashr.tv

import com.tanush.stashr.tv.core.Health
import com.tanush.stashr.tv.core.HealthError
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTest {
    private val now = 10_000_000_000L

    @Test fun unknownValuesAreLeftOutAndKnownOnesKept() {
        val h = Health.build("1.3.0", 130, 30, "Xiaomi MiBox", overlay = true, accessibility = false, batteryUnrestricted = null, notifications = null, usbStorage = true, lastError = null, now = now)
        assertEquals("1.3.0", h.getString("appVersion")); assertEquals(130, h.getInt("versionCode")); assertEquals(30, h.getInt("sdk")); assertEquals("Xiaomi MiBox", h.getString("model"))
        assertTrue(h.getBoolean("overlay")); assertFalse(h.getBoolean("accessibility")); assertTrue(h.getBoolean("usbStorage"))
        assertFalse(h.has("batteryUnrestricted")); assertFalse(h.has("notifications"))
        assertTrue(h.isNull("lastError"))
    }

    @Test fun theLastErrorIsKeptForSevenDaysAndShortened() {
        val fresh = HealthError(now - 3600_000L, "crash", "x".repeat(500))
        val h = Health.build("1", 1, 30, "m", null, null, null, null, null, fresh, now)
        val e: JSONObject = h.getJSONObject("lastError")
        assertEquals("crash", e.getString("where")); assertEquals(Health.MAX_TEXT, e.getString("text").length); assertEquals(now - 3600_000L, e.getLong("at"))
        val old = HealthError(now - Health.KEEP_MS - 1, "sync", "old")
        assertTrue(Health.build("1", 1, 30, "m", null, null, null, null, null, old, now).isNull("lastError"))
        val future = HealthError(now + 1000, "cast", "clock went back")
        assertTrue(Health.build("1", 1, 30, "m", null, null, null, null, null, future, now).isNull("lastError"))
    }

    private fun fa(): Nothing = fb()
    private fun fb(): Nothing = fc()
    private fun fc(): Nothing = fd()
    private fun fd(): Nothing = throw IllegalStateException("boom")

    @Test fun anExceptionIsDescribedWithItsFirstThreeFrames() {
        val text = try { fa() } catch (t: Throwable) { Health.describe(t) }
        assertTrue(text.startsWith("java.lang.IllegalStateException: boom at "))
        assertEquals(3, Regex(" at ").findAll(text).count())
        assertTrue(text.length <= Health.MAX_TEXT)
    }
}

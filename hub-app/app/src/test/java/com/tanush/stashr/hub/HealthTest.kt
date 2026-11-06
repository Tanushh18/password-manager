package com.tanush.stashr.hub

import com.tanush.stashr.hub.core.HealthLogic
import com.tanush.stashr.hub.core.HealthLogic.Flags
import com.tanush.stashr.hub.core.HealthLogic.LastError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTest {
    private val day = 24L * 3600 * 1000

    @Test fun crashTextHasTheClassTheMessageAndThreeFrames() {
        val t = IllegalStateException("boom")
        val text = HealthLogic.crashText(t)
        assertTrue(text.startsWith("java.lang.IllegalStateException: boom @ "))
        assertEquals(2, Regex(" < ").findAll(text).count())
        assertTrue(text.length <= HealthLogic.MAX_TEXT)
        assertTrue(HealthLogic.crashText(RuntimeException("x".repeat(1000))).length <= HealthLogic.MAX_TEXT)
    }

    @Test fun anErrorIsKeptForSevenDaysAndANewerOneReplacesIt() {
        val now = 1_000_000_000_000L
        val old = LastError(now - 8 * day, "crash", "old")
        val recent = LastError(now - 2 * day, "report", "recent")
        assertNull(HealthLogic.alive(old, now))
        assertNotNull(HealthLogic.alive(recent, now))
        assertNull(HealthLogic.alive(LastError(now + 5000, "x", "future"), now))
        assertEquals(recent, HealthLogic.newer(old, recent))
        assertEquals(recent, HealthLogic.newer(recent, old))
        assertEquals(recent, HealthLogic.newer(null, recent))
    }

    @Test fun threeFailuresInARowAreNoted() {
        val s = HealthLogic.Streak(3)
        assertFalse(s.fail()); assertFalse(s.fail()); assertTrue(s.fail())
        assertFalse(s.fail())
        s.ok()
        assertFalse(s.fail()); assertFalse(s.fail()); assertTrue(s.fail())
    }

    @Test fun accessibilityServiceIsFoundInEitherSpelling() {
        val pkg = "com.tanush.stashr.hub"; val cls = "com.tanush.stashr.hub.whatsapp.WhatsAppAccessibility"
        assertTrue(HealthLogic.serviceEnabled("$pkg/$cls", pkg, cls))
        assertTrue(HealthLogic.serviceEnabled("other/Other:$pkg/.whatsapp.WhatsAppAccessibility", pkg, cls))
        assertFalse(HealthLogic.serviceEnabled("other/Other", pkg, cls))
        assertFalse(HealthLogic.serviceEnabled(null, pkg, cls))
        assertFalse(HealthLogic.serviceEnabled("", pkg, cls))
    }

    @Test fun theJsonCarriesOnlyWhatIsKnown() {
        val j = HealthLogic.build("1.9.0", 100010, 34, "Pixel Tablet", null, Flags(overlay = false, camera = true, microphone = null))
        assertEquals("1.9.0", j.getString("appVersion")); assertEquals(100010, j.getInt("versionCode")); assertEquals(34, j.getInt("sdk"))
        assertFalse(j.getBoolean("overlay")); assertTrue(j.getBoolean("camera"))
        assertFalse(j.has("microphone")); assertFalse(j.has("notifications"))
        assertTrue(j.isNull("lastError"))
        val withError = HealthLogic.build("1.9.0", 1, 34, "m", LastError(5L, "camera", "x".repeat(900)), Flags())
        assertEquals("camera", withError.getJSONObject("lastError").getString("where"))
        assertEquals(HealthLogic.MAX_TEXT, withError.getJSONObject("lastError").getString("text").length)
    }

    @Test fun theCheckCardListsWhatIsWrongRedFirst() {
        val p = HealthLogic.problems(Flags(overlay = true, notifications = false, camera = false, microphone = true, batteryUnrestricted = null, accessibility = false))
        assertEquals(listOf("camera", "notifications", "accessibility"), p.map { it.id })
        assertTrue(p.first().red); assertFalse(p.last().red)
        assertTrue(p.first().fix.contains("Camera"))
        assertTrue(HealthLogic.problems(Flags(overlay = true, camera = true)).isEmpty())
    }
}

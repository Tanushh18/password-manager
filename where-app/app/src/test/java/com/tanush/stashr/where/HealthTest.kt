package com.tanush.stashr.where

import com.tanush.stashr.where.core.HealthLogic
import com.tanush.stashr.where.core.HealthLogic.Flags
import com.tanush.stashr.where.core.HealthLogic.LastError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTest {
    private val day = 24L * 3600 * 1000

    @Test fun crashTextHasTheClassTheMessageAndThreeFrames() {
        val text = HealthLogic.crashText(IllegalStateException("boom"))
        assertTrue(text.startsWith("java.lang.IllegalStateException: boom @ "))
        assertEquals(2, Regex(" < ").findAll(text).count())
        assertTrue(HealthLogic.crashText(RuntimeException("x".repeat(1000))).length <= HealthLogic.MAX_TEXT)
    }

    @Test fun anErrorIsKeptForSevenDaysAndANewerOneReplacesIt() {
        val now = 1_000_000_000_000L
        val old = LastError(now - 8 * day, "crash", "old")
        val recent = LastError(now - 2 * day, "location", "recent")
        assertNull(HealthLogic.alive(old, now))
        assertNotNull(HealthLogic.alive(recent, now))
        assertEquals(recent, HealthLogic.newer(old, recent))
        assertEquals(recent, HealthLogic.newer(recent, old))
    }

    @Test fun threeFailuresInARowAreNoted() {
        val s = HealthLogic.Streak(3)
        assertFalse(s.fail()); assertFalse(s.fail()); assertTrue(s.fail())
        assertFalse(s.fail()); s.ok()
        assertFalse(s.fail()); assertFalse(s.fail()); assertTrue(s.fail())
    }

    @Test fun locationStateNeedsTheBackgroundPermissionFromAndroidTen() {
        assertEquals("denied", HealthLogic.locationState(false, false, true, 34))
        assertEquals("whileInUse", HealthLogic.locationState(true, false, false, 34))
        assertEquals("always", HealthLogic.locationState(true, false, true, 34))
        assertEquals("always", HealthLogic.locationState(false, true, true, 31))
        assertEquals("always", HealthLogic.locationState(true, false, false, 28))   // before Android 10 there is no separate permission
    }

    @Test fun theJsonCarriesOnlyWhatIsKnown() {
        val j = HealthLogic.build("1.5.0", 100010, 34, "Pixel 8", null, Flags(location = "whileInUse", gpsEnabled = true, notifications = null, batteryUnrestricted = false))
        assertEquals("whileInUse", j.getString("location")); assertTrue(j.getBoolean("gpsEnabled")); assertFalse(j.getBoolean("batteryUnrestricted"))
        assertFalse(j.has("notifications"))
        assertTrue(j.isNull("lastError"))
        val e = HealthLogic.build("1.5.0", 1, 34, "m", LastError(7L, "report", "y".repeat(900)), Flags())
        assertEquals("report", e.getJSONObject("lastError").getString("where"))
        assertEquals(HealthLogic.MAX_TEXT, e.getJSONObject("lastError").getString("text").length)
    }

    @Test fun theChecklistHasTheWebsiteItemsInOrder() {
        val ok = HealthLogic.items(Flags("always", true, true, true))
        assertEquals(listOf("location", "gpsEnabled", "notifications", "batteryUnrestricted"), ok.map { it.id })
        assertTrue(ok.all { it.ok })
        val bad = HealthLogic.items(Flags("whileInUse", false, false, false))
        assertEquals(listOf(false, false, false, false), bad.map { it.ok })
        assertEquals("Only while the app is open", bad.first().value)
        assertTrue(bad[0].red && bad[1].red && !bad[2].red && !bad[3].red)
        // unknown values do not show a problem
        assertTrue(HealthLogic.items(Flags("always", null, null, null)).all { it.ok })
        assertTrue(HealthLogic.items(Flags("always"), approximateOnly = true).first().value.contains("approximate"))
    }
}

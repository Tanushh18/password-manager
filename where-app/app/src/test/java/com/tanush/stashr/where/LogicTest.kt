package com.tanush.stashr.where

import com.tanush.stashr.where.core.Logic
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test fun delayIsClamped() {
        assertEquals(900, Logic.clampDelay(null))
        assertEquals(900, Logic.clampDelay(0))
        assertEquals(60, Logic.clampDelay(5))
        assertEquals(300, Logic.clampDelay(300))
        assertEquals(1800, Logic.clampDelay(99999))
    }

    @Test fun liveDelayIsFiveToThirtySeconds() {
        assertEquals(8, Logic.clampDelay(null, true))
        assertEquals(8, Logic.clampDelay(0, true))
        assertEquals(5, Logic.clampDelay(1, true))
        assertEquals(8, Logic.clampDelay(8, true))
        assertEquals(30, Logic.clampDelay(600, true))
        // not live: the old 1 to 30 minutes
        assertEquals(60, Logic.clampDelay(8, false))
        assertEquals(900, Logic.clampDelay(null, false))
        assertEquals(1800, Logic.clampDelay(9999, false))
    }

    @Test fun liveFlagIsParsed() {
        assertEquals(true, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"coming","live":true,"nextCheckSec":8}""")).live)
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"home"}""")).live)
    }

    @Test fun answerIsParsed() {
        val a = Logic.parseAnswer(JSONObject("""{"ok":true,"state":"coming","distanceKm":12.4,"etaMinutes":25,"nextCheckSec":120,"home":{"set":true},"notices":[{"id":"n1","text":"Open the door"},{"id":"n2","text":" "}]}"""))
        assertEquals("coming", a.state); assertEquals(12.4, a.distanceKm!!, 0.001); assertEquals(25, a.etaMinutes); assertEquals(120, a.nextCheckSec)
        assertEquals(listOf("n1" to "Open the door"), a.notices); assertTrue(a.homeSet)
        val b = Logic.parseAnswer(JSONObject("""{"ok":true,"state":"unset","home":{"set":false}}"""))
        assertNull(b.distanceKm); assertNull(b.nextCheckSec); assertFalse(b.homeSet); assertTrue(b.notices.isEmpty())
    }

    @Test fun statusInFriendlyWords() {
        assertEquals("At home", Logic.statusText("home", 0.0, null))
        assertEquals("12.4 km from home · about 25 min away", Logic.statusText("coming", 12.4, 25))
        assertEquals("30.0 km from home", Logic.statusText("away", 30.0, null))
        assertEquals("Home location not set on Stashr yet", Logic.statusText("unset", null, null))
        assertEquals("2 h 5 min", Logic.minutes(125))
    }

    @Test fun passiveFixesNeedMovementAndTime() {
        assertTrue(Logic.passiveWorthUploading(500.0, 3 * 60_000))
        assertFalse(Logic.passiveWorthUploading(100.0, 10 * 60_000))
        assertFalse(Logic.passiveWorthUploading(900.0, 60_000))
        assertTrue(Logic.passiveWorthUploading(null, 3 * 60_000))
    }

    @Test fun distanceAndCode() {
        assertEquals(1112.0, Logic.distanceM(28.0, 77.0, 28.01, 77.0), 5.0)
        assertEquals("ABCD1234", Logic.cleanCode("abcd 1234 xyz"))
    }
}

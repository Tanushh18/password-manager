package com.tanush.stashr.where

import com.tanush.stashr.where.core.RoomLogic
import com.tanush.stashr.where.core.RoomLogic.Hear
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomLogicTest {
    @Test fun strongestKeepsOneReadingPerIdLoudestFirstAndDropsJunk() {
        val s = RoomLogic.strongest(listOf(Hear("AA:01", -70), Hear("aa:01", -50), Hear("bb:02", -60), Hear("", -40), Hear("cc:03", 5), Hear("dd:04", -200)))
        assertEquals(listOf("aa:01" to -50, "bb:02" to -60), s.map { it.id to it.rssi })
    }

    @Test fun onlyTheStrongestFortyAreKept() {
        val many = (1..100).map { Hear("id$it", -30 - it / 2) }
        assertEquals(RoomLogic.MAX_IDS, RoomLogic.strongest(many).size)
        assertEquals("id1", RoomLogic.strongest(many).first().id)
    }

    @Test fun everyDifferentWifiResultIsItsOwnScanAndBluetoothIsSharedByAll() {
        val a = listOf(Hear("w1", -50), Hear("w2", -60)); val b = listOf(Hear("w1", -52), Hear("w2", -61)); val ble = listOf(Hear("d1", -70))
        val scans = RoomLogic.buildScans(listOf(a, b, a), ble)             // the repeated one is not counted twice
        assertEquals(2, scans.size)
        assertEquals(1, scans[0].getJSONArray("ble").length())
        assertEquals(50, -scans[0].getJSONArray("wifi").getJSONObject(0).getInt("r"))
    }

    @Test fun noWifiButBluetoothIsOneScanAndNothingHeardIsNone() {
        assertEquals(1, RoomLogic.buildScans(emptyList(), listOf(Hear("d1", -60), Hear("d2", -70))).size)
        assertTrue(RoomLogic.buildScans(emptyList(), listOf(Hear("d1", -60))).isEmpty())          // one device is too little
        assertTrue(RoomLogic.buildScans(listOf(listOf(Hear("w1", -50))), emptyList()).isEmpty())
        assertFalse(RoomLogic.heardEnough(listOf(Hear("w1", -50)), emptyList()))
    }

    @Test fun oneTapSendsAtMostTwelveScans() {
        val sets = (1..30).map { i -> listOf(Hear("w1", -40 - i), Hear("w2", -60)) }
        assertEquals(RoomLogic.MAX_SCANS, RoomLogic.buildScans(sets, emptyList()).size)
    }

    @Test fun aTypedRoomNameIsTidiedAndMatchedToAnExistingRoom() {
        assertEquals("living room", RoomLogic.cleanRoom("  living   room "))
        assertTrue(RoomLogic.cleanRoom("<b>x</b>")!!.none { it in "<>&\"" })
        assertEquals(null, RoomLogic.cleanRoom(" a "))
        assertEquals(null, RoomLogic.cleanRoom(""))
        assertEquals(24, RoomLogic.cleanRoom("x".repeat(40))!!.length)
        assertEquals("Kitchen", RoomLogic.resolveRoom("kitchen", listOf("Bedroom", "Kitchen")))
        assertEquals("Garage", RoomLogic.resolveRoom("Garage", listOf("Bedroom", "Kitchen")))
    }

    @Test fun wordingAndCounts() {
        val rooms = listOf("Bedroom", "Kitchen", "Hall")
        val counts = RoomLogic.parseCounts(JSONObject("""{"Bedroom":32,"Kitchen":3}"""))
        assertEquals("Bedroom 32 · Kitchen 3 · Hall 0", RoomLogic.summary(rooms, counts))
        assertEquals(listOf("Kitchen", "Hall"), RoomLogic.thin(rooms, counts))
        assertEquals("Abhi koi kamra nahi: neeche ek kamra add karo.", RoomLogic.summary(emptyList(), emptyMap()))
        assertEquals(rooms, RoomLogic.rooms(JSONObject("""{"rooms":["Bedroom","Kitchen","Hall"]}""")))
        assertTrue(RoomLogic.parseCounts(null).isEmpty())
    }
}

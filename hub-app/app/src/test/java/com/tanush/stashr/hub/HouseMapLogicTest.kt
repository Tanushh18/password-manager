package com.tanush.stashr.hub

import com.tanush.stashr.hub.core.HouseMapLogic
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HouseMapLogicTest {
    private val json = JSONObject("""{
      "zones":[
        {"id":"a","name":"Hall","auto":false,"hint":"tablet sits here","x":0,"y":0,"w":2,"h":2,"hub":true,"devices":[{"label":"Sony TV","up":true},{"label":"Stick","up":false}],"people":[{"person":"Papa"}]},
        {"id":"b","name":"Zone 2","auto":true,"hint":"phones sleep here (bedroom?)","x":2.5,"y":0,"w":2,"h":2,"devices":[],"people":[]},
        {"id":"room:Kitchen","name":"Kitchen","labelOnly":true,"x":0,"y":2.5,"w":2,"h":2,"devices":[],"people":[]}],
      "away":[{"person":"Mom","distanceKm":3.2},{"person":"Tanush","distanceKm":null}]}""")

    @Test fun readsZonesWithTheirMarkers() {
        val b = HouseMapLogic.parse(json)
        assertEquals(listOf("Hall", "Zone 2", "Kitchen"), b.map { it.name })
        assertEquals(listOf("hub", "device-up", "device-down", "person"), b[0].markers.map { it.kind })
        assertEquals("", b[0].hint)                              // your own name needs no guess shown
        assertEquals("phones sleep here (bedroom?)", b[1].hint)  // a name Stashr chose shows why
        assertTrue(b[2].labelOnly)
    }

    @Test fun awayLine() {
        assertEquals("Bahar: Mom (3.2 km), Tanush", HouseMapLogic.awayLine(json))
        assertEquals("", HouseMapLogic.awayLine(JSONObject("""{"away":[]}""")))
        assertTrue(HouseMapLogic.parse(JSONObject("{}")).isEmpty())
    }

    @Test fun isometricMathsGoesTheRightWay() {
        assertTrue(HouseMapLogic.isoX(1.0, 0.0, 10.0) > HouseMapLogic.isoX(0.0, 0.0, 10.0))     // right
        assertTrue(HouseMapLogic.isoY(1.0, 0.0, 0.0, 10.0) > HouseMapLogic.isoY(0.0, 0.0, 0.0, 10.0))   // and down
        assertTrue(HouseMapLogic.isoX(0.0, 1.0, 10.0) < HouseMapLogic.isoX(0.0, 0.0, 10.0))     // back goes left
        assertTrue(HouseMapLogic.isoY(0.0, 0.0, 1.0, 10.0) < HouseMapLogic.isoY(0.0, 0.0, 0.0, 10.0))   // height goes up
        val (w, h) = HouseMapLogic.extent(HouseMapLogic.parse(json))
        assertEquals(4.5, w, 0.0001); assertEquals(4.5, h, 0.0001)
        assertEquals(listOf("a", "b", "room:Kitchen").sorted().first(), HouseMapLogic.backToFront(HouseMapLogic.parse(json)).first().id)
    }
}

package com.tanush.stashr.hub

import com.tanush.stashr.hub.core.RoomLiveLogic
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomLiveLogicTest {
    private val live = JSONObject("""{
      "running": true,
      "summary": {"phones": 2, "on": 1, "trained": 1, "cvAccuracy": 92, "fieldAccuracy": 50},
      "phones": [
        {"person": "Papa", "on": true, "trained": true,
         "current": {"name": "Kitchen", "confidence": 0.82, "sure": true, "fresh": true, "ageSec": 12, "nearest": 6.4, "samples": 64, "heard": {"wifi": 24, "ble": 7},
                     "ranking": [{"room": "Kitchen", "p": 0.82}, {"room": "Bedroom", "p": 0.18}]},
         "cv": {"accuracy": 92, "tested": 120, "unsure": 4, "verdict": "Good: rooms are told apart well."},
         "field": {"confirmed": 1, "wrong": 1, "total": 2, "accuracy": 50}},
        {"person": "Mom", "on": false, "trained": false, "current": null, "cv": {"tested": 0}, "field": {"total": 0}}
      ]}""")

    @Test fun showsTheRoomEveryRoomsShareAndEveryCalculatedValue() {
        val v = RoomLiveLogic.parse(live)
        assertTrue(v.running); assertEquals("RUNNING", v.status)
        assertEquals("1/2 phones on · 1 trained · accuracy 92% · asli 50%", v.summary)
        val papa = v.phones[0]
        assertEquals("Kitchen", papa.headline); assertTrue(papa.sure)
        assertEquals(listOf("Kitchen" to 82, "Bedroom" to 18), papa.bars.map { it.label to it.pct })
        assertTrue(papa.values.contains("pakka: 82% · aakhri scan 12 s pehle"))
        assertTrue(papa.values.contains("doori (sabse paas ka sample): 6.4 dBm"))
        assertTrue(papa.values.contains("suna: Wi-Fi 24 · Bluetooth 7 · samples 64"))
        assertTrue(papa.values.contains("accuracy (chhupa ke guess): 92% · 120 scan ka test · 4% pakka nahi"))
        assertTrue(papa.values.contains("asli accuracy (aapke taps): 50% · 1 sahi, 1 galat"))
    }

    @Test fun anUntrainedPhoneSaysWhatToDo() {
        val mom = RoomLiveLogic.parse(live).phones[1]
        assertEquals("train nahi hua", mom.headline); assertFalse(mom.sure)
        assertTrue(mom.warning.contains("2 kamre train"))
        assertTrue(mom.values.contains("accuracy: abhi nahi bani"))
        assertTrue(mom.values.contains("asli accuracy: abhi koi tap nahi"))
    }

    @Test fun anUnsureOrOldAnswerIsMarkedAndStoppedIsStopped() {
        val j = JSONObject("""{"running": false, "summary": {"phones": 1, "on": 1, "trained": 1}, "phones": [{"person": "Papa", "on": true, "trained": true,
            "current": {"name": "Hall", "confidence": 0.4, "sure": false, "fresh": true, "ageSec": 200, "why": "two rooms look alike", "ranking": []}, "cv": {"tested": 0}, "field": {"total": 0}}]}""")
        val v = RoomLiveLogic.parse(j)
        assertEquals("STOPPED", v.status)
        assertEquals("Hall (?)", v.phones[0].headline)
        assertEquals("two rooms look alike", v.phones[0].warning)
        assertEquals("1/1 phones on · 1 trained", v.summary)
        val old = RoomLiveLogic.parse(JSONObject("""{"phones": [{"person": "P", "on": true, "trained": true, "current": {"name": "Hall", "confidence": 0.9, "sure": true, "fresh": false, "ageSec": 9000}, "cv": {}, "field": {}}]}"""))
        assertEquals("Hall (purana)", old.phones[0].headline)
    }

    @Test fun barsAndTimes() {
        assertEquals("██████████░░░░░░░░░░", RoomLiveLogic.bar(50))
        assertEquals("░░░░░░░░░░░░░░░░░░░░", RoomLiveLogic.bar(0)); assertEquals("█".repeat(20), RoomLiveLogic.bar(130))
        assertEquals("abhi", RoomLiveLogic.ago(2)); assertEquals("45 s pehle", RoomLiveLogic.ago(45)); assertEquals("5 min pehle", RoomLiveLogic.ago(300)); assertEquals("3 ghante pehle", RoomLiveLogic.ago(11000))
    }
}

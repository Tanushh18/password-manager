package com.tanush.stashr.hub.core

import org.json.JSONObject

/**
 * The tablet's "Room Model" screen, as pure code (no Android types, unit-tested): turns what GET /home/agent/room/live returns into the
 * lines the screen draws. The website shows the same numbers from the same endpoint, so the two always agree.
 */
object RoomLiveLogic {
    data class Bar(val label: String, val pct: Int)
    data class PhoneView(val person: String, val headline: String, val sure: Boolean, val on: Boolean, val bars: List<Bar>, val values: List<String>, val warning: String)
    data class View(val running: Boolean, val status: String, val summary: String, val phones: List<PhoneView>)

    /** "████████░░░░" for a percentage. */
    fun bar(pct: Int, width: Int = 20): String {
        val full = (pct.coerceIn(0, 100) * width + 50) / 100
        return "█".repeat(full) + "░".repeat(width - full)
    }

    fun ago(sec: Int): String = when { sec < 5 -> "abhi"; sec < 90 -> "$sec s pehle"; sec < 5400 -> "${(sec + 30) / 60} min pehle"; else -> "${sec / 3600} ghante pehle" }

    private fun pctOf(d: Double) = Math.round(d * 100).toInt()

    fun parse(j: JSONObject): View {
        val running = j.optBoolean("running")
        val s = j.optJSONObject("summary") ?: JSONObject()
        val summary = buildString {
            append("${s.optInt("on")}/${s.optInt("phones")} phones on · ${s.optInt("trained")} trained")
            if (!s.isNull("cvAccuracy") && s.has("cvAccuracy")) append(" · accuracy ${s.optInt("cvAccuracy")}%")
            if (!s.isNull("fieldAccuracy") && s.has("fieldAccuracy")) append(" · asli ${s.optInt("fieldAccuracy")}%")
        }
        val arr = j.optJSONArray("phones")
        val phones = (0 until (arr?.length() ?: 0)).map { arr!!.getJSONObject(it) }.map { p ->
            val cur = p.optJSONObject("current"); val cv = p.optJSONObject("cv") ?: JSONObject(); val field = p.optJSONObject("field") ?: JSONObject()
            val on = p.optBoolean("on")
            val values = ArrayList<String>()
            var warning = ""
            val bars = ArrayList<Bar>()
            var headline: String; var sure = false
            if (cur == null) {
                headline = if (!p.optBoolean("trained")) "train nahi hua" else if (!on) "band" else "scan ka intezaar"
                if (!p.optBoolean("trained")) warning = "Phone par Room Lab mein kam se kam 2 kamre train karo."
            } else {
                sure = cur.optBoolean("sure", true) && cur.optBoolean("fresh", true)
                headline = if (cur.optBoolean("fresh", true)) cur.optString("name") + if (cur.optBoolean("sure", true)) "" else " (?)" else "${cur.optString("name")} (purana)"
                val rk = cur.optJSONArray("ranking")
                for (i in 0 until (rk?.length() ?: 0)) rk!!.getJSONObject(i).let { bars.add(Bar(it.optString("room"), pctOf(it.optDouble("p")))) }
                val heard = cur.optJSONObject("heard") ?: JSONObject()
                values.add("pakka: ${pctOf(cur.optDouble("confidence"))}% · aakhri scan ${ago(cur.optInt("ageSec"))}")
                if (!cur.isNull("nearest")) values.add("doori (sabse paas ka sample): ${cur.optDouble("nearest")} dBm")
                values.add("suna: Wi-Fi ${heard.optInt("wifi")} · Bluetooth ${heard.optInt("ble")} · samples ${cur.optInt("samples")}")
                if (!cur.optBoolean("sure", true) && cur.optString("why").isNotEmpty()) warning = cur.optString("why")
            }
            if (cv.optInt("tested") > 0) values.add("accuracy (chhupa ke guess): ${cv.optInt("accuracy")}% · ${cv.optInt("tested")} scan ka test · ${cv.optInt("unsure")}% pakka nahi") else values.add("accuracy: abhi nahi bani")
            values.add(if (field.optInt("total") > 0) "asli accuracy (aapke taps): ${field.optInt("accuracy")}% · ${field.optInt("confirmed")} sahi, ${field.optInt("wrong")} galat" else "asli accuracy: abhi koi tap nahi")
            if (cv.optString("verdict").isNotEmpty()) values.add(cv.optString("verdict"))
            PhoneView(p.optString("person"), headline, sure, on, bars, values, warning)
        }
        return View(running, if (running) "RUNNING" else "STOPPED", summary, phones)
    }
}

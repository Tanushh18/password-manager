package com.tanush.stashr.where.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * The pure part of Room Lab (no Android types, unit-tested): what a scan looks like when it leaves the phone, and the small bits of
 * wording. The guess itself (which room?) is made on the server, see server/utils/roomModel.js.
 *
 * A SCAN is "what this phone hears right now": Wi-Fi networks and Bluetooth devices, each with its signal strength in dBm
 * (about -30 = very close, -90 = barely heard). Ids are the raw addresses here; the server turns them into unreadable codes at once.
 */
object RoomLogic {
    data class Hear(val id: String, val rssi: Int)

    const val MAX_IDS = 40          // the strongest ones are enough, and keep the upload small
    const val MAX_SCANS = 12        // one tap sends at most this many scans (Android only allows a few new Wi-Fi scans a minute anyway)
    const val MIN_HEARD = 2         // a scan that heard fewer than this is useless

    /** One entry per id (the strongest reading wins), loudest first, at most [n]. */
    fun strongest(list: List<Hear>, n: Int = MAX_IDS): List<Hear> =
        list.filter { it.id.isNotBlank() && it.rssi in -127..-1 }.groupBy { it.id.lowercase() }
            .map { (id, v) -> Hear(id, v.maxOf { it.rssi }) }.sortedByDescending { it.rssi }.take(n)

    fun scanJson(wifi: List<Hear>, ble: List<Hear>): JSONObject {
        fun arr(l: List<Hear>) = JSONArray().also { a -> strongest(l).forEach { a.put(JSONObject().put("b", it.id).put("r", it.rssi)) } }
        return JSONObject().put("wifi", arr(wifi)).put("ble", arr(ble))
    }

    fun heardEnough(wifi: List<Hear>, ble: List<Hear>) = strongest(wifi).size + strongest(ble).size >= MIN_HEARD

    /**
     * Turns what one tap collected into scans to upload. Every DIFFERENT Wi-Fi result becomes its own scan (all of them are used), each with the
     * Bluetooth devices heard during the tap. No Wi-Fi result at all but Bluetooth heard: one scan. Nothing usable: empty.
     */
    fun buildScans(wifiSets: List<List<Hear>>, ble: List<Hear>): List<JSONObject> {
        val distinct = ArrayList<List<Hear>>()
        for (w in wifiSets) if (distinct.none { sameSet(it, w) }) distinct.add(w)
        val sets = if (distinct.isEmpty()) listOf(emptyList()) else distinct
        return sets.filter { heardEnough(it, ble) }.take(MAX_SCANS).map { scanJson(it, ble) }
    }

    private fun sameSet(a: List<Hear>, b: List<Hear>): Boolean {
        val x = strongest(a).associate { it.id to it.rssi }; val y = strongest(b).associate { it.id to it.rssi }
        return x == y
    }

    /** Readings of Bluetooth devices over a few seconds -> one entry per device with its strongest reading. */
    fun mergeReadings(readings: List<Hear>): List<Hear> = strongest(readings)

    fun parseCounts(j: JSONObject?): Map<String, Int> = if (j == null) emptyMap() else j.keys().asSequence().associateWith { j.optInt(it) }

    fun rooms(j: JSONObject): List<String> = j.optJSONArray("rooms")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()

    /** Rooms with too little training (fewer than [min] scans). */
    fun thin(rooms: List<String>, counts: Map<String, Int>, min: Int = 5): List<String> = rooms.filter { (counts[it] ?: 0) < min }

    fun summary(rooms: List<String>, counts: Map<String, Int>): String =
        if (rooms.isEmpty()) "Abhi koi kamra nahi: neeche ek kamra add karo." else rooms.joinToString(" · ") { "$it ${counts[it] ?: 0}" }

    fun newSession(now: Long) = "s$now"

    /** A typed room name made safe and tidy ("  living   room " -> "living room"), or null when it is shorter than 2 letters. */
    fun cleanRoom(raw: String): String? {
        val s = raw.replace(Regex("[\\u0000-\\u001f<>&\"]"), " ").replace(Regex("\\s+"), " ").trim().take(24).trim()
        return if (s.length >= 2) s else null
    }

    /** If the name is already a room (ignoring capital letters) use that room's own spelling, else the typed name (a new room). */
    fun resolveRoom(typed: String, rooms: List<String>): String = rooms.firstOrNull { it.equals(typed, ignoreCase = true) } ?: typed
}

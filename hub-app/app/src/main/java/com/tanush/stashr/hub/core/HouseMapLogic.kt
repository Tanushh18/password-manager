package com.tanush.stashr.hub.core

import org.json.JSONObject

/** The pure part of the tablet's house map: reads what GET /home/agent/map returns and does the isometric maths (no Android types, unit-tested). */
object HouseMapLogic {
    data class Marker(val kind: String, val label: String)
    data class Block(val id: String, val name: String, val x: Double, val y: Double, val w: Double, val h: Double, val labelOnly: Boolean, val hint: String, val markers: List<Marker>)

    const val BLOCK_H = 0.55
    private const val COS = 0.8660254

    fun parse(j: JSONObject): List<Block> {
        val zones = j.optJSONArray("zones") ?: return emptyList()
        return (0 until zones.length()).map { zones.getJSONObject(it) }.map { z ->
            val m = ArrayList<Marker>()
            if (z.optBoolean("hub")) m.add(Marker("hub", "Tablet"))
            z.optJSONArray("devices")?.let { a -> for (i in 0 until a.length()) a.getJSONObject(i).let { d -> m.add(Marker(if (d.optBoolean("up")) "device-up" else "device-down", d.optString("label"))) } }
            z.optJSONArray("people")?.let { a -> for (i in 0 until a.length()) m.add(Marker("person", a.getJSONObject(i).optString("person"))) }
            Block(z.optString("id"), z.optString("name"), z.optDouble("x", 0.0), z.optDouble("y", 0.0), z.optDouble("w", 2.0), z.optDouble("h", 2.0), z.optBoolean("labelOnly"), if (z.optBoolean("auto")) z.optString("hint") else "", m)
        }
    }

    fun awayLine(j: JSONObject): String {
        val a = j.optJSONArray("away") ?: return ""
        if (a.length() == 0) return ""
        val names = (0 until a.length()).map { a.getJSONObject(it) }.joinToString(", ") { p -> p.optString("person") + if (p.has("distanceKm") && !p.isNull("distanceKm")) " (${p.optDouble("distanceKm")} km)" else "" }
        return "Bahar: $names"
    }

    /** Isometric pixel position of a grid point at height z. */
    fun isoX(x: Double, y: Double, s: Double) = (x - y) * COS * s
    fun isoY(x: Double, y: Double, z: Double, s: Double) = (x + y) * 0.5 * s - z * s

    fun extent(blocks: List<Block>): Pair<Double, Double> = if (blocks.isEmpty()) 2.0 to 2.0 else blocks.maxOf { it.x + it.w } to blocks.maxOf { it.y + it.h }

    /** Blocks back to front, so a nearer block covers a farther one. */
    fun backToFront(blocks: List<Block>): List<Block> = blocks.sortedBy { it.x + it.y }
}

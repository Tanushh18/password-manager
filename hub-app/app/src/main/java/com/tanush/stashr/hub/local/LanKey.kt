package com.tanush.stashr.hub.local

/**
 * The key Stashr gives a Wi-Fi device, mirrored from server/utils/home.js (slug, usefulName, lanKey, and the "two devices
 * with the same name in one scan keep their IP keys" rule), so the tablet can match the server's person labels offline.
 */
object LanKey {
    private val GENERIC = setOf("android", "iphone", "ipad", "localhost", "unknown", "espressif", "esp", "router", "gateway", "device", "host")
    private val IP_SLUG = Regex("^\\d+(-\\d+){3}$")
    private val NON_ALNUM = Regex("[^a-z0-9]+")

    fun slug(v: String?): String = (v ?: "").lowercase().replace(NON_ALNUM, "-").trim('-').take(60)

    fun usefulName(n: String?): Boolean { val s = slug(n); return s.length >= 3 && s !in GENERIC && !IP_SLUG.matches(s) }

    fun key(mac: String?, name: String?, ip: String?): String {
        val m = slug(mac)
        if (m.isNotEmpty() && m != "02-00-00-00-00-00") return m
        if (!name.isNullOrEmpty() && usefulName(name)) return "n-" + slug(name).take(58)
        return slug(ip)
    }

    /** One key per device of a scan; a name that two devices share falls back to each one's IP. Triples are (mac, name, ip). */
    fun keys(devices: List<Triple<String, String, String>>): List<String> {
        val first = devices.map { key(it.first, it.second, it.third) }
        val count = HashMap<String, Int>()
        for (k in first) if (k.startsWith("n-")) count[k] = (count[k] ?: 0) + 1
        return first.mapIndexed { i, k -> if ((count[k] ?: 0) > 1) slug(devices[i].third) else k }
    }
}

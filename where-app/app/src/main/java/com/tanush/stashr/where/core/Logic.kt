package com.tanush.stashr.where.core

import org.json.JSONObject
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** What the server answered to a location upload. */
data class Answer(
    val state: String,          // home | away | coming | unset
    val distanceKm: Double?,
    val etaMinutes: Int?,
    val nextCheckSec: Int?,
    val notices: List<Pair<String, String>>,   // (id, text)
    val homeSet: Boolean
)

/** Pure helpers (no Android), so they can be unit-tested. */
object Logic {
    const val DEFAULT_DELAY_SEC = 900
    const val MIN_DELAY_SEC = 60
    const val MAX_DELAY_SEC = 1800

    /** The server says when to look again; keep it between 1 and 30 minutes, 15 when it says nothing. */
    fun clampDelay(sec: Int?): Int = if (sec == null || sec <= 0) DEFAULT_DELAY_SEC else sec.coerceIn(MIN_DELAY_SEC, MAX_DELAY_SEC)

    fun parseAnswer(json: JSONObject): Answer {
        val notices = ArrayList<Pair<String, String>>()
        val arr = json.optJSONArray("notices")
        if (arr != null) for (i in 0 until arr.length()) {
            val n = arr.optJSONObject(i) ?: continue
            val text = n.optString("text").trim()
            if (text.isNotEmpty()) notices.add(n.optString("id", text).ifEmpty { text } to text)
        }
        return Answer(
            state = json.optString("state", "unset"),
            distanceKm = if (json.has("distanceKm") && !json.isNull("distanceKm")) json.optDouble("distanceKm") else null,
            etaMinutes = if (json.has("etaMinutes") && !json.isNull("etaMinutes")) json.optInt("etaMinutes") else null,
            nextCheckSec = if (json.has("nextCheckSec") && !json.isNull("nextCheckSec")) json.optInt("nextCheckSec") else null,
            notices = notices,
            homeSet = json.optJSONObject("home")?.optBoolean("set", true) ?: (json.optString("state") != "unset")
        )
    }

    fun km(v: Double): String = if (v >= 100) "%.0f".format(v) else "%.1f".format(v)

    fun minutes(m: Int): String = if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"

    /** The line shown on the main screen. */
    fun statusText(state: String, distanceKm: Double?, etaMinutes: Int?): String = when (state) {
        "unset" -> "Home location not set on Stashr yet"
        "home" -> "At home"
        "coming" -> if (distanceKm != null && etaMinutes != null && etaMinutes > 0) "${km(distanceKm)} km from home · about ${minutes(etaMinutes)} away"
                    else if (distanceKm != null) "${km(distanceKm)} km from home · on the way" else "On the way home"
        "away" -> if (distanceKm != null) "${km(distanceKm)} km from home" else "Away from home"
        else -> "Waiting for the first check"
    }

    /** Metres between two points. */
    fun distanceM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1.0, sqrt(h)))
    }

    /** A passive fix is worth an upload only after moving more than 300 m and 2 minutes since the last upload. */
    fun passiveWorthUploading(movedM: Double?, sinceLastUploadMs: Long): Boolean =
        sinceLastUploadMs > 2 * 60_000 && (movedM == null || movedM > 300)

    fun cleanCode(raw: String): String = raw.uppercase().filter { it.isLetterOrDigit() }.take(8)

    fun ago(ms: Long, now: Long = System.currentTimeMillis()): String {
        val s = (now - ms) / 1000
        return when {
            ms <= 0 -> "never"
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86400 -> "${s / 3600} h ago"
            else -> "${s / 86400} d ago"
        }
    }
}

package com.tanush.stashr.tv.core

import org.json.JSONObject

/** Small pure rules, kept apart from Android so they can be tested. */
object Logic {
    /** A file name from the server made safe for the movie folder: no folders, no "..", no control characters. Null if nothing is left. */
    fun safeName(raw: String?): String? {
        var n = (raw ?: "").replace(Regex("[\\u0000-\\u001f\\u007f]"), " ")
        n = n.substringAfterLast('/').substringAfterLast('\\')
        n = n.replace(Regex("[:*?\"<>|]"), "_").trim().trimStart('.').trim()
        if (n.length > 150) n = n.take(150)
        return if (n.isEmpty() || n == "." || n == "..") null else n
    }

    /** Where to ask the server to continue: 0 if nothing usable is on disk, the length of the .part file when it is shorter than the movie. -1 = already complete. */
    fun resumeFrom(partLength: Long, total: Long): Long = when {
        total <= 0 -> 0
        partLength == total -> -1
        partLength in 1 until total -> partLength
        else -> 0
    }

    /** Files of the manifest that are not on disk with the right size yet. */
    fun missing(manifest: List<Pair<String, Long>>, local: Map<String, Long>): List<Pair<String, Long>> =
        manifest.filter { (n, size) -> local[n] != size }

    /** "mirror": what this app downloaded earlier but Drive no longer has. "move": nothing, the TV keeps its copies. */
    fun mirrorDeletes(mode: String, syncedBefore: Set<String>, manifestNames: Set<String>): List<String> =
        if (mode == "mirror") syncedBefore.filter { it !in manifestNames }.sorted() else emptyList()

    /** The new music-stream volume index for a volume command, or null for mute (the caller toggles it) / bad arguments. */
    fun volumeTarget(args: JSONObject, current: Int, max: Int): Int? {
        if (max <= 0) return null
        return when (args.optString("action")) {
            "up" -> minOf(max, current + maxOf(1, max / 15))
            "down" -> maxOf(0, current - maxOf(1, max / 15))
            else -> if (args.has("level")) { val l = args.optInt("level", -1); if (l in 0..100) Math.round(l * max / 100f) else null } else null
        }
    }

    fun isMute(args: JSONObject) = args.optString("action") == "mute"

    fun size(bytes: Long): String = when {
        bytes >= 1L shl 30 -> "%.1f GB".format(bytes / (1024.0 * 1024 * 1024))
        bytes >= 1L shl 20 -> "%d MB".format(bytes / (1024 * 1024))
        else -> "%d KB".format(maxOf(bytes / 1024, 0))
    }

    /** A movie's title for the screen: the file name without its extension and with dots/underscores as spaces. */
    fun title(fileName: String): String = fileName.substringBeforeLast('.', fileName).replace('_', ' ').replace('.', ' ').replace(Regex("\\s+"), " ").trim().ifEmpty { fileName }

    fun greeting(hour: Int) = when (hour) { in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; in 17..21 -> "Good evening"; else -> "Good night" }

    private val FAVOURITES = listOf("com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "in.startv.hotstar", "com.google.android.youtube.tv", "com.google.android.youtube.tvmusic", "com.mxtech.videoplayer.television", "com.graymatrix.did")

    /** Favourites first (in the order above), then everything else A-Z. */
    fun <T> sortApps(apps: List<T>, pkg: (T) -> String, label: (T) -> String): List<T> =
        apps.sortedWith(compareBy<T>({ val i = FAVOURITES.indexOf(pkg(it)); if (i < 0) FAVOURITES.size else i }, { label(it).lowercase() }))

    /** Where a YouTube link should open on a TV: the music app for music.youtube.com, else the YouTube TV app. */
    fun youtubePackage(url: String): String = if (url.contains("music.youtube.com")) "com.google.android.youtube.tvmusic" else "com.google.android.youtube.tv"
}

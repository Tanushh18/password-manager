package com.tanush.stashr.hub.local

data class LocalCmd(val kind: String, val type: String, val args: Map<String, Any> = emptyMap())

/** What a sentence means without the server. [scene] is a scene id, [who] asks who is home, [cmds] go to the TV or this tablet. */
data class LocalResult(val reply: String, val cmds: List<LocalCmd> = emptyList(), val scene: String? = null, val who: Boolean = false)

/**
 * A small, pure copy of the server's assistant rules (server/utils/homeAssistant.js) for the things that matter when the
 * server cannot be reached: the TV's volume, play/pause, next/previous, apps, home/back, the camera, scenes and "who is
 * home". Anything else needs the server.
 */
object LocalRules {
    val APPS = listOf(
        listOf("netflix") to ("com.netflix.ninja" to "Netflix"),
        listOf("prime", "amazon", "prime video") to ("com.amazon.amazonvideo.livingroom" to "Prime Video"),
        listOf("hotstar", "jiohotstar", "disney") to ("in.startv.hotstar" to "JioHotstar"),
        listOf("youtube music", "yt music") to ("com.google.android.youtube.tvmusic" to "YouTube Music"),
        listOf("youtube", "yt") to ("com.google.android.youtube.tv" to "YouTube"),
        listOf("mx player", "mx") to ("com.mxtech.videoplayer.television" to "MX Player"),
        listOf("zee5", "zee 5") to ("com.graymatrix.did" to "Zee5")
    )
    const val NEEDS_SERVER = "I need the server for that."

    fun norm(s: String): String = s.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s.%+-]"), " ").replace(Regex("\\s+"), " ").trim()
    private fun has(text: String, words: List<String>) = words.any { Regex("(^|[^a-z0-9])" + Regex.escape(it) + "($|[^a-z0-9])").containsMatchIn(text) }

    private fun findApp(text: String): Pair<String, String>? =
        APPS.flatMap { (names, app) -> names.map { it to app } }.sortedByDescending { it.first.length }.firstOrNull { has(text, listOf(it.first)) }?.second

    /** scenes: (id, name) pairs. */
    fun parse(sentence: String, scenes: List<Pair<String, String>> = emptyList()): LocalResult {
        val text = norm(sentence)
        if (text.isEmpty()) return LocalResult("Say something like “pause” or “tv ki awaaz badhao”.")
        val tv = { type: String, args: Map<String, Any>, reply: String -> LocalResult(reply, listOf(LocalCmd("tv", type, args))) }
        val hub = { type: String, args: Map<String, Any>, reply: String -> LocalResult(reply, listOf(LocalCmd("hub", type, args))) }

        if (has(text, listOf("kaun ghar", "kon ghar", "who is home", "whos home", "ghar pe kaun", "ghar par kaun", "ghar me kaun", "ghar mein kaun", "anyone home"))) return LocalResult("", who = true)
        scenes.sortedByDescending { it.second.length }.firstOrNull { it.second.isNotBlank() && text.contains(norm(it.second)) }?.let { return LocalResult("Running “${it.second}”.", scene = it.first) }

        if (has(text, listOf("camera"))) {
            if (has(text, listOf("off", "band", "disarm", "stop", "bandh"))) return hub("camera", mapOf("action" to "disarm"), "Camera alerts are off.")
            if (has(text, listOf("video", "clip", "recording"))) return hub("camera", mapOf("action" to "clip"), "Recording a short clip.")
            if (has(text, listOf("photo", "pic", "picture", "snapshot", "dikhao", "dekho"))) return hub("camera", mapOf("action" to "snapshot"), "Taking a photo.")
            if (has(text, listOf("on", "chalu", "start", "arm", "shuru"))) return hub("camera", mapOf("action" to "arm"), "Camera alerts are on.")
        }

        val level = Regex("(?:volume|awaaz|awaz)[^0-9]*([0-9]{1,3})\\b|\\b([0-9]{1,3}) ?%").find(text)
        if (has(text, listOf("volume", "awaaz", "awaz", "sound", "mute", "unmute", "louder", "quieter"))) {
            if (has(text, listOf("mute", "unmute", "chup"))) return tv("volume", mapOf("action" to "mute"), "Toggling mute.")
            val n = level?.groupValues?.drop(1)?.firstOrNull { it.isNotEmpty() }?.toIntOrNull()
            if (n != null && n in 0..100) return tv("volume", mapOf("level" to n), "Setting the volume to $n.")
            if (has(text, listOf("up", "badhao", "badha", "zyada", "jyada", "increase", "louder", "high", "tez"))) return tv("volume", mapOf("action" to "up"), "Volume up.")
            if (has(text, listOf("down", "kam", "ghatao", "decrease", "lower", "quieter", "low", "dheere", "dhire"))) return tv("volume", mapOf("action" to "down"), "Volume down.")
        }

        val app = findApp(text)
        if (has(text, listOf("pause", "roko", "rok", "ruko", "stop"))) return tv("media", mapOf("action" to "play_pause"), "Pausing.")
        if (has(text, listOf("resume", "play", "chalao", "chala", "continue", "shuru")) && app == null && !Regex("movie|film").containsMatchIn(text)) return tv("media", mapOf("action" to "play_pause"), "Playing.")
        if (has(text, listOf("next", "agla", "agli", "skip"))) return tv("media", mapOf("action" to "next"), "Next.")
        if (has(text, listOf("previous", "pichla", "pichli", "prev"))) return tv("media", mapOf("action" to "previous"), "Previous.")

        if ((has(text, listOf("home")) && has(text, listOf("tv", "jao", "go", "screen", "button"))) || text == "home") return tv("key", mapOf("key" to "HOME"), "Going to the TV home screen.")
        if (text == "back" || (has(text, listOf("peeche", "pichhe")) && has(text, listOf("jao", "go")))) return tv("key", mapOf("key" to "BACK"), "Going back.")

        if (app != null && has(text, listOf("open", "kholo", "khol", "launch", "start", "chalao", "chala", "lagao", "laga", "play", "dikhao", "on"))) return tv("launch_app", mapOf("package" to app.first), "Opening ${app.second}.")
        return LocalResult(NEEDS_SERVER)
    }

    /** The same checks the server makes for a TV command, so a bad local command is never queued. */
    fun validTvCommand(type: String, args: Map<String, Any?>): Boolean = when (type) {
        "launch_app" -> Regex("^[A-Za-z0-9_.]{3,200}$").matches(args["package"]?.toString() ?: "")
        "volume" -> args["action"] in listOf("up", "down", "mute") || ((args["level"] as? Number)?.toInt() ?: -1) in 0..100
        "media" -> args["action"] in listOf("play_pause", "next", "previous")
        "key" -> args["key"] in listOf("HOME", "BACK")
        "open_url" -> (args["url"]?.toString() ?: "").startsWith("https://") && (args["url"]?.toString()?.length ?: 0) <= 500
        "sync_now" -> true
        "remove_movie", "play_movie" -> (args["name"]?.toString() ?: "").let { it.isNotBlank() && it.length <= 200 && !it.contains('/') && !it.contains('\u0000') }
        "notify" -> (args["text"]?.toString() ?: "").let { it.isNotBlank() && it.length <= 200 }
        else -> false
    }
}

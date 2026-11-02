package com.tanush.stashr.hub.local

import android.content.Context
import android.content.Intent
import com.tanush.stashr.hub.camera.CameraWatch
import com.tanush.stashr.hub.net.ScanResult
import com.tanush.stashr.hub.ui.AnnounceActivity
import com.tanush.stashr.hub.ui.SlideshowActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Local mode: what the tablet does by itself when the Stashr server cannot be reached for a while. It keeps the last
 * dashboard, runs scenes and spoken/typed sentences with [LocalRules], queues commands for the TV (which fetches them
 * from the tablet's LAN server), announces arrivals it sees on the Wi-Fi, and remembers what happened so the server hears
 * about it later (localEvents). Nothing here speaks.
 */
object LocalMode {
    const val ACTION_STATE = "com.tanush.stashr.hub.LOCAL_STATE"
    @Volatile var offline = false
        private set

    private val tvQueues = ConcurrentHashMap<String, ArrayDeque<JSONObject>>()
    private val tvStatus = ConcurrentHashMap<String, JSONObject>()
    private val tvSeen = ConcurrentHashMap<String, Long>()
    private var counter = 0L

    /** Wi-Fi devices of people (lanKey -> person), when each person was last on the Wi-Fi, and who is on it now. */
    private val lastOn = ConcurrentHashMap<String, Long>()
    @Volatile private var presentNow: Set<String> = emptySet()
    private const val ABSENT_MS = 10 * 60_000L

    fun setOffline(ctx: Context, value: Boolean) {
        if (offline == value) return
        offline = value
        ctx.applicationContext.sendBroadcast(Intent(ACTION_STATE).setPackage(ctx.packageName).putExtra("offline", value))
    }

    /* ───────── remembered things ───────── */

    private fun file(ctx: Context, name: String) = File(ctx.applicationContext.filesDir, name)
    fun saveDashboard(ctx: Context, json: String) { try { file(ctx, "dashboard.json").writeText(json) } catch (e: Exception) { } }
    fun cachedDashboard(ctx: Context): JSONObject? = try { file(ctx, "dashboard.json").takeIf { it.exists() }?.readText()?.let { JSONObject(it) } } catch (e: Exception) { null }

    private fun scenes(ctx: Context): List<Triple<String, String, JSONArray>> {
        val a = cachedDashboard(ctx)?.optJSONArray("scenes") ?: return emptyList()
        return (0 until a.length()).map { a.getJSONObject(it) }.map { Triple(it.optString("id"), it.optString("name"), it.optJSONArray("steps") ?: JSONArray()) }
    }

    private fun people(ctx: Context): Map<String, String> {
        val o = cachedDashboard(ctx)?.optJSONObject("localPeople") ?: return emptyMap()
        return o.keys().asSequence().associateWith { o.optString(it) }
    }

    private fun tvNames(ctx: Context): Set<String> {
        val names = HashSet<String>(tvStatus.keys)
        val a = cachedDashboard(ctx)?.optJSONArray("tvs")
        if (a != null) for (i in 0 until a.length()) a.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { names.add(it.take(40)) }
        return names
    }

    /* ───────── events for the server ───────── */

    private val events = JSONArray()
    @Synchronized fun addEvent(ctx: Context, kind: String, text: String) {
        if (events.length() == 0) try { file(ctx, "local-events.json").takeIf { it.exists() }?.readText()?.let { val a = JSONArray(it); for (i in 0 until a.length()) events.put(a.get(i)) } } catch (e: Exception) { }
        events.put(JSONObject().put("kind", kind).put("text", text.take(250)).put("at", System.currentTimeMillis()))
        while (events.length() > 100) events.remove(0)
        try { file(ctx, "local-events.json").writeText(events.toString()) } catch (e: Exception) { }
    }
    @Synchronized fun pendingEvents(ctx: Context): JSONArray {
        if (events.length() == 0) try { file(ctx, "local-events.json").takeIf { it.exists() }?.readText()?.let { val a = JSONArray(it); for (i in 0 until a.length()) events.put(a.get(i)) } } catch (e: Exception) { }
        return JSONArray(events.toString())
    }
    @Synchronized fun eventsSent(ctx: Context, count: Int) {
        repeat(minOf(count, events.length())) { events.remove(0) }
        try { file(ctx, "local-events.json").writeText(events.toString()) } catch (e: Exception) { }
    }

    /* ───────── the TV, through the LAN server ───────── */

    fun tvReport(name: String, status: JSONObject?): JSONArray {
        val n = name.trim().take(40).ifEmpty { "TV" }
        if (status != null) tvStatus[n] = status
        tvSeen[n] = System.currentTimeMillis()
        val q = tvQueues.getOrPut(n) { ArrayDeque() }
        val out = JSONArray()
        synchronized(q) { while (q.isNotEmpty() && out.length() < 10) out.put(q.removeFirst()) }
        return out
    }

    fun queueTv(ctx: Context, type: String, args: Map<String, Any>): Int {
        if (!LocalRules.validTvCommand(type, args)) return 0
        val names = tvNames(ctx)
        for (n in names) {
            val q = tvQueues.getOrPut(n) { ArrayDeque() }
            synchronized(q) {
                if (q.size >= 20) q.removeFirst()
                q.addLast(JSONObject().put("id", "local-${System.currentTimeMillis()}-${counter++}").put("type", type).put("args", JSONObject(args)))
            }
        }
        return names.size
    }

    /* ───────── running things locally ───────── */

    private fun runHub(ctx: Context, type: String, args: Map<String, Any?>): Boolean {
        when (type) {
            "camera" -> when (args["action"]) {
                "arm" -> CameraWatch.arm(); "disarm" -> CameraWatch.disarm(); "snapshot" -> CameraWatch.snapshot(); "clip" -> CameraWatch.clip()
                else -> return false
            }
            "slideshow" -> if (args["action"] == "stop") ctx.sendBroadcast(Intent(SlideshowActivity.ACTION_STOP).setPackage(ctx.packageName))
                else ctx.startActivity(Intent(ctx, SlideshowActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            else -> return false
        }
        return true
    }

    private fun toMap(o: JSONObject?): Map<String, Any> = o?.let { j -> j.keys().asSequence().associateWith { j.get(it) } } ?: emptyMap()

    fun runScene(ctx: Context, id: String): Int {
        val steps = scenes(ctx).firstOrNull { it.first == id }?.third ?: return 0
        var n = 0
        for (i in 0 until steps.length()) {
            val s = steps.optJSONObject(i) ?: continue
            val args = toMap(s.optJSONObject("args"))
            if (s.optString("kind") == "tv") { if (queueTv(ctx, s.optString("type"), args) > 0) n++ }
            else if (s.optString("kind") == "hub" && runHub(ctx, s.optString("type"), args)) n++
        }
        return n
    }

    /** A sentence answered without the server. Returns the text to show. */
    fun answer(ctx: Context, sentence: String): String {
        val r = LocalRules.parse(sentence, scenes(ctx).map { it.first to it.second })
        if (r.who) return whoLine(ctx)
        if (r.scene != null) { val n = runScene(ctx, r.scene); return if (n > 0) "${r.reply} (offline mode)" else "That scene has nothing the devices can do right now." }
        for (c in r.cmds) {
            if (c.kind == "tv") { if (queueTv(ctx, c.type, c.args) == 0) return "No TV has reported on the home Wi-Fi yet." }
            else runHub(ctx, c.type, c.args)
        }
        return if (r.cmds.isNotEmpty()) "${r.reply} (offline mode)" else r.reply
    }

    fun whoLine(ctx: Context): String {
        val all = people(ctx).values.toSet()
        if (all.isEmpty()) return "Nobody is set up yet, and I need the server to show it."
        val home = all.filter { it in presentNow }.sorted(); val out = all.filter { it !in presentNow }.sorted()
        return listOf(if (home.isNotEmpty()) "Home: ${home.joinToString(", ")}." else "Nobody is home.", if (out.isNotEmpty()) "Out: ${out.joinToString(", ")}." else "").joinToString(" ").trim()
    }

    /* ───────── arrivals seen on the Wi-Fi ───────── */

    /** Called after every Wi-Fi scan. While the server is unreachable, a person whose device was absent for 10 minutes and is back gets announced. */
    fun onScan(ctx: Context, scan: ScanResult) {
        val map = people(ctx)
        if (map.isEmpty()) { presentNow = emptySet(); return }
        val devices = scan.devices.filter { it.up }
        val keys = LanKey.keys(devices.map { Triple(it.mac, it.name, it.ip) })
        val now = System.currentTimeMillis()
        val here = HashSet<String>()
        for (k in keys) map[k]?.let { here.add(it) }
        presentNow = here
        for (person in here) {
            val last = lastOn[person] ?: 0L
            lastOn[person] = now
            if (offline && last != 0L && now - last >= ABSENT_MS) {
                val text = "Open the door: $person arrived home"
                AnnounceActivity.show(ctx.applicationContext, text, false, true)
                queueTv(ctx, "notify", mapOf("text" to text))
                addEvent(ctx, "arrived", "$person arrived home")
            }
        }
    }
}

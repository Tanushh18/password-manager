package com.tanush.stashr.hub.core

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.delay
import kotlin.math.sqrt

/**
 * An experiment, not a feature: can this tablet notice somebody walking between it and the router just from the Wi-Fi signal strength
 * (RSSI) it reads? It records the signal for a minute while nobody moves, then for a minute while somebody walks between the tablet and the
 * router, and reports how well the two can be told apart. The maths is here, pure and unit-tested; [WifiProbe] below runs it on the tablet.
 */
object WifiProbeLogic {
    /** Samples per window: 6 seconds at 4 readings a second. */
    const val WINDOW = 24

    data class Stats(val n: Int, val updates: Int, val mean: Double, val std: Double, val min: Int, val max: Int)
    /** hit / falseAlarm are percentages of windows. */
    data class Result(val verdict: String, val hit: Int, val falseAlarm: Int, val quiet: Stats, val motion: Stats, val threshold: Double)

    private fun std(v: List<Int>): Double {
        if (v.size < 2) return 0.0
        val m = v.average()
        return sqrt(v.sumOf { (it - m) * (it - m) } / v.size)
    }

    fun stats(s: List<Int>): Stats {
        if (s.isEmpty()) return Stats(0, 0, 0.0, 0.0, 0, 0)
        var changes = 0
        for (i in 1 until s.size) if (s[i] != s[i - 1]) changes++
        return Stats(s.size, changes, s.average(), std(s), s.min(), s.max())
    }

    /** The standard deviation of each full window (the last short one is dropped). */
    fun windowStds(s: List<Int>, size: Int = WINDOW): List<Double> = (0 until s.size / size).map { std(s.subList(it * size, (it + 1) * size)) }

    private fun percentile(v: List<Double>, p: Double): Double {
        if (v.isEmpty()) return 0.0
        val s = v.sorted()
        return s[((s.size - 1) * p).toInt().coerceIn(0, s.size - 1)]
    }

    /**
     * The first half of the quiet minute sets the threshold (the 90th percentile of its window spread, plus a margin; never below 0.5 dB).
     * The second half of the quiet minute then counts false alarms and the walking minute counts hits. Too few changes in the reading
     * (Android throttles it) means nothing can be said.
     */
    fun evaluate(quiet: List<Int>, motion: List<Int>): Result {
        val q = stats(quiet); val m = stats(motion)
        val half = quiet.size / 2
        val calib = windowStds(quiet.subList(0, half))
        val quietTest = windowStds(quiet.subList(half, quiet.size))
        val walk = windowStds(motion)
        val threshold = maxOf(0.5, percentile(calib, 0.9)) + 0.25
        if (q.updates < 20 || m.updates < 20 || calib.isEmpty() || quietTest.isEmpty() || walk.isEmpty()) return Result("TOO_FEW_UPDATES", 0, 0, q, m, threshold)
        val pct = { l: List<Double> -> (100.0 * l.count { it > threshold } / l.size).toInt() }
        val hit = pct(walk); val fa = pct(quietTest)
        val verdict = when { hit >= 70 && fa <= 15 -> "USABLE"; hit >= 45 && fa <= 30 -> "WEAK"; else -> "NOT_USABLE" }
        return Result(verdict, hit, fa, q, m, threshold)
    }

    private fun d1(x: Double) = "%.1f".format(java.util.Locale.US, x)

    /** One line for the website / Telegram (the server keeps 200 characters). */
    fun text(r: Result, band: String): String =
        if (r.verdict == "TOO_FEW_UPDATES") "Wi-Fi motion test: TOO_FEW_UPDATES · this tablet's signal reading changes only ${r.quiet.updates}/${r.motion.updates} times a minute ($band), too slow to see anybody"
        else "Wi-Fi motion test: ${r.verdict} · walking seen ${r.hit}%, false alarms ${r.falseAlarm}% · still ±${d1(r.quiet.std)} dB, walking ±${d1(r.motion.std)} dB · $band, ${r.motion.updates} changes/min"
}

object WifiProbe {
    @Volatile private var running = false
    const val PHASE_MS = 60_000L
    const val STEP_MS = 250L

    @Suppress("DEPRECATION")
    private fun reading(wm: WifiManager): Int? = try { wm.connectionInfo?.rssi?.takeIf { it in -126..-1 } } catch (e: Exception) { null }

    private suspend fun sample(wm: WifiManager): List<Int> {
        val out = ArrayList<Int>()
        val end = System.currentTimeMillis() + PHASE_MS
        while (System.currentTimeMillis() < end) { reading(wm)?.let { out.add(it) }; delay(STEP_MS) }
        return out
    }

    private fun say(ctx: Context, text: String) = com.tanush.stashr.hub.ui.AnnounceActivity.show(ctx, text, true, false)

    @Suppress("DEPRECATION")
    suspend fun run(ctx: Context): String {
        if (running) return "A Wi-Fi test is already running"
        val wm = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return "No Wi-Fi on this tablet"
        if (reading(wm) == null) return "The tablet is not on Wi-Fi"
        val band = try { if ((wm.connectionInfo?.frequency ?: 0) > 4900) "5 GHz" else "2.4 GHz" } catch (e: Exception) { "?" }
        running = true
        try {
            say(ctx, "Wi-Fi test shuru. Tablet ko router ke saamne rakhiye aur ek minute tak shant rahiye. Koi na chale.")
            delay(10_000)
            val quiet = sample(wm)
            say(ctx, "Ab ek minute tak router aur tablet ke beech aana-jaana kijiye.")
            delay(5_000)
            val motion = sample(wm)
            say(ctx, "Wi-Fi test poora hua. Shukriya.")
            return WifiProbeLogic.text(WifiProbeLogic.evaluate(quiet, motion), band)
        } finally { running = false }
    }
}

package com.tanush.stashr.tv.core

import java.io.IOException

/**
 * The pure rules of local mode (no Android classes, so they are unit-tested): when to leave the server for the tablet,
 * when to try the server again, how long the cached home screen may be shown, and which tablet addresses are safe.
 */
object LocalPolicy {
    const val GO_LOCAL_AFTER_MS = 45_000L          // the server has failed this long in a row
    const val RETRY_SERVER_MS = 60_000L            // while local, look at the server this often
    const val LOCAL_EVERY_MS = 10_000L             // report to the tablet this often
    const val HOME_MAX_AGE_MS = 24 * 3600_000L     // the cached weather / headlines are shown for a day at most
    const val ADDR_MAX_AGE_MS = 30L * 24 * 3600_000L
    const val FIND_EVERY_MS = 30_000L              // do not start a new search for the tablet more often than this

    fun shouldGoLocal(firstFailAt: Long, now: Long) = firstFailAt > 0 && now - firstFailAt >= GO_LOCAL_AFTER_MS
    fun shouldRetryServer(lastTryAt: Long, now: Long) = now - lastTryAt >= RETRY_SERVER_MS
    fun homeFresh(savedAt: Long, now: Long) = savedAt > 0 && now - savedAt in 0..HOME_MAX_AGE_MS

    /** A report that did not get through: no connection, a timeout, or the server itself failing (HTTP 5xx). */
    fun isFailure(e: Throwable) = if (e is ApiError) e.status >= 500 else e is IOException

    data class Addr(val host: String, val port: Int) { override fun toString() = "$host:$port" }

    /** Only addresses inside the home network: the key is never sent to anything on the internet. */
    fun privateHost(h: String): Boolean {
        val p = h.split(".").map { it.toIntOrNull() ?: return false }
        if (p.size != 4 || p.any { it !in 0..255 }) return false
        return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168) || (p[0] == 169 && p[1] == 254)
    }

    fun parseAddr(s: String?): Addr? {
        val t = s?.trim().orEmpty()
        val i = t.lastIndexOf(':')
        if (i <= 0) return null
        val port = t.substring(i + 1).toIntOrNull() ?: return null
        val host = t.substring(0, i)
        return if (port in 1..65535 && privateHost(host)) Addr(host, port) else null
    }

    /** The saved address is used first, for 30 days. */
    fun cachedAddr(saved: String?, savedAt: Long, now: Long): Addr? = if (savedAt > 0 && now - savedAt in 0..ADDR_MAX_AGE_MS) parseAddr(saved) else null

    fun mayFindAgain(lastFindAt: Long, now: Long) = now - lastFindAt >= FIND_EVERY_MS
}

package com.tanush.stashr.hub.local

import android.content.Context
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.ApiError
import java.io.File
import java.io.IOException

/**
 * Camera photos and clips that could not reach the server wait here, on disk (up to 200 MB, oldest dropped first), and
 * are sent in order once the server answers again.
 */
object MediaQueue {
    private const val MAX_BYTES = 200L * 1024 * 1024
    private val lock = Any()

    private fun dir(ctx: Context) = File(ctx.applicationContext.filesDir, "mediaq").also { it.mkdirs() }

    /** True when a failure looks like "the server is not there" rather than "the server said no". */
    fun worthKeeping(e: Exception) = e is ApiError && e.status >= 500 || e is IOException && e !is ApiError

    fun enqueue(ctx: Context, kind: String, reason: String, bytes: ByteArray) {
        synchronized(lock) {
            val d = dir(ctx)
            File(d, "${System.currentTimeMillis()}-${kind}-${reason.filter { it.isLetter() }.ifEmpty { "x" }}.bin").writeBytes(bytes)
            var files = d.listFiles()?.sortedBy { it.name } ?: return
            var total = files.sumOf { it.length() }
            var i = 0
            while (total > MAX_BYTES && i < files.size - 1) { total -= files[i].length(); files[i].delete(); i++ }
        }
    }

    fun flush(ctx: Context) {
        val api = Api(ctx)
        while (true) {
            val next = synchronized(lock) { dir(ctx).listFiles()?.minByOrNull { it.name } } ?: return
            val parts = next.name.removeSuffix(".bin").split("-")
            val kind = parts.getOrNull(1) ?: "photo"; val reason = parts.getOrNull(2) ?: "motion"
            try { api.uploadMedia(kind, reason, next.readBytes()) }
            catch (e: Exception) { if (worthKeeping(e)) return; }
            synchronized(lock) { next.delete() }
        }
    }
}

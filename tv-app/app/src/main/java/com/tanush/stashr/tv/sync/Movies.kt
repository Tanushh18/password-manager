package com.tanush.stashr.tv.sync

import android.content.Context
import android.os.Environment
import android.os.StatFs
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/** One movie on the storage. */
data class Movie(val name: String, val size: Long, val file: File, val synced: Boolean)

/** Where the movies live (the USB drive when there is one), and which of them this app downloaded. */
object MovieStore {
    private const val FOLDER = "Stashr Movies"
    private const val INDEX = ".stashr-index.json"

    /** The first removable volume (USB / SD) if present, else the app's own folder on internal storage. */
    fun dir(ctx: Context): File {
        val roots = ctx.getExternalFilesDirs(null).filterNotNull()
        val usb = roots.firstOrNull { try { Environment.isExternalStorageRemovable(it) } catch (e: Exception) { false } }
        val base = usb ?: roots.firstOrNull() ?: ctx.filesDir
        return File(base, FOLDER).also { it.mkdirs() }
    }

    fun onUsb(ctx: Context): Boolean {
        val roots = ctx.getExternalFilesDirs(null).filterNotNull()
        return roots.any { try { Environment.isExternalStorageRemovable(it) } catch (e: Exception) { false } }
    }

    private fun indexFile(ctx: Context) = File(dir(ctx), INDEX)

    /** Names this app downloaded (and so may delete again). */
    fun index(ctx: Context): MutableSet<String> {
        val f = indexFile(ctx)
        if (!f.exists()) return mutableSetOf()
        return try { val a = JSONArray(f.readText()); (0 until a.length()).map { a.getString(it) }.toMutableSet() } catch (e: Exception) { mutableSetOf() }
    }

    fun saveIndex(ctx: Context, names: Set<String>) { try { indexFile(ctx).writeText(JSONArray(names.sorted()).toString()) } catch (e: Exception) { /* storage gone */ } }

    /** Every complete movie file on the storage, newest first. */
    fun list(ctx: Context): List<Movie> {
        val ours = index(ctx)
        return (dir(ctx).listFiles() ?: emptyArray())
            .filter { it.isFile && !it.name.startsWith(".") && !it.name.endsWith(".part") && it.length() > 0 }
            .sortedByDescending { it.lastModified() }
            .map { Movie(it.name, it.length(), it, it.name in ours) }
    }

    fun find(ctx: Context, name: String): Movie? { val n = Logic.safeName(name) ?: return null; return list(ctx).firstOrNull { it.name == n } }

    /** Deletes a movie from the storage. Only files directly inside the movie folder. */
    fun remove(ctx: Context, name: String): Boolean {
        val m = find(ctx, name) ?: return false
        val ok = m.file.delete()
        if (ok) saveIndex(ctx, index(ctx).also { it.remove(m.name) })
        return ok
    }

    fun freeBytes(ctx: Context): Long = try { StatFs(dir(ctx).path).availableBytes } catch (e: Exception) { 0 }
    fun totalBytes(ctx: Context): Long = try { StatFs(dir(ctx).path).totalBytes } catch (e: Exception) { 0 }
    fun usedByMovies(ctx: Context): Long = list(ctx).sumOf { it.size }
}

/** What the sync is doing, for the next status and for the home screen. */
data class SyncState(val active: Boolean = false, val name: String = "", val pct: Int = 0, val error: String = "", val finishedAt: Long = 0)

/** Downloads the movies in the Drive folder to the storage, one at a time, resuming a half file. */
class MovieSync(private val ctx: Context) {
    private val running = AtomicBoolean(false)
    @Volatile var state = SyncState()
        private set

    /** Runs a whole sync; returns false if one was already running. Blocking: call from a background thread. */
    fun runOnce(onChange: () -> Unit): Boolean {
        if (!running.compareAndSet(false, true)) return false
        val prefs = Prefs(ctx)
        try {
            if (!prefs.linked) return true
            state = SyncState(active = true); onChange()
            val api = Api(ctx)
            val m = api.manifest()
            val mode = if (m.optString("mode") == "move") "move" else "mirror"
            val arr = m.optJSONArray("files") ?: JSONArray()
            data class Item(val name: String, val size: Long, val path: String)
            val items = (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val name = Logic.safeName(o.optString("name")) ?: return@mapNotNull null
                val path = o.optString("path")
                if (path.isEmpty() || o.optLong("size") <= 0) null else Item(name, o.optLong("size"), path)
            }
            val dir = MovieStore.dir(ctx)
            val ours = MovieStore.index(ctx)

            // The USB copy follows the Drive folder ("mirror"): drop what this app downloaded and Drive no longer has.
            for (gone in Logic.mirrorDeletes(mode, ours, items.map { it.name }.toSet())) {
                File(dir, gone).delete(); ours.remove(gone)
            }
            MovieStore.saveIndex(ctx, ours)

            val local = MovieStore.list(ctx).associate { it.name to it.size }
            for ((name, size) in Logic.missing(items.map { it.name to it.size }, local)) {
                val item = items.first { it.name == name }
                if (MovieStore.freeBytes(ctx) < size + 64L * 1024 * 1024) { state = SyncState(active = true, name = name, error = "Not enough free space for $name"); onChange(); continue }
                try {
                    download(api, item.path, File(dir, name), size) { pct -> state = SyncState(active = true, name = name, pct = pct); onChange() }
                    ours.add(name); MovieStore.saveIndex(ctx, ours)
                    prefs.lastUploadAt = System.currentTimeMillis(); prefs.lastUploadName = name
                    onChange()
                } catch (e: Exception) {
                    state = SyncState(active = true, name = name, error = e.message ?: "Download failed"); onChange()
                    if (e is com.tanush.stashr.tv.core.ApiError && e.status == 401) throw e
                }
            }
            val err = state.error
            state = SyncState(finishedAt = System.currentTimeMillis(), error = err)
        } catch (e: Exception) {
            state = SyncState(finishedAt = System.currentTimeMillis(), error = e.message ?: "Sync failed")
        } finally { running.set(false); onChange() }
        return true
    }

    private fun download(api: Api, path: String, target: File, total: Long, progress: (Int) -> Unit) {
        val part = File(target.parentFile, target.name + ".part")
        var start = Logic.resumeFrom(if (part.exists()) part.length() else 0, total)
        if (start == -1L) { part.renameTo(target); return }
        var conn = api.fileConnection(path, start)
        if (start > 0 && conn.responseCode != 206) { conn.disconnect(); part.delete(); start = 0; conn = api.fileConnection(path, 0) }
        var done = start
        var lastPct = -1
        try {
            FileOutputStream(part, start > 0).use { out ->
                conn.inputStream.use { input ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n); done += n
                        val pct = (done * 100 / total).toInt()
                        if (pct != lastPct) { lastPct = pct; progress(pct) }
                    }
                    out.fd.sync()
                }
            }
        } finally { conn.disconnect() }
        if (part.length() != total) throw java.io.IOException("The download of ${target.name} stopped early; it will continue next time.")
        if (target.exists()) target.delete()
        if (!part.renameTo(target)) throw java.io.IOException("Could not save ${target.name}.")
    }
}

internal fun movieJson(list: List<Movie>): JSONArray = JSONArray().also { a ->
    for (m in list) a.put(JSONObject().put("name", m.name).put("size", m.size).put("where", if (m.synced) "Synced" else "USB drive"))
}

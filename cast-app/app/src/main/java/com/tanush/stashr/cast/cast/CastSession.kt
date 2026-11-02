package com.tanush.stashr.cast.cast

import com.tanush.stashr.cast.core.Logic
import java.net.Socket

/**
 * What the screen and the service share (they live in one process): the connection that was opened and checked before the
 * system's "start recording" dialog, and the numbers the main screen shows while casting.
 */
object CastSession {
    class Pending(val socket: Socket, val tvName: String, val w: Int, val h: Int, val fps: Int, val quality: Logic.Quality, val audio: Boolean)

    @Volatile var pending: Pending? = null
    @Synchronized fun takePending(): Pending? { val p = pending; pending = null; return p }
    @Synchronized fun dropPending() { try { pending?.socket?.close() } catch (_: Exception) { }; pending = null }

    @Volatile var casting = false
    @Volatile var tvName = ""
    @Volatile var width = 0
    @Volatile var height = 0
    @Volatile var fps = 0
    @Volatile var bitrate = 0
    @Volatile var bytesPerSec = 0L
    @Volatile var dropped = 0
    @Volatile var note = ""          // e.g. "Sound is not sent: this phone does not allow it"
    @Volatile var error = ""         // why the last cast ended, shown once
}

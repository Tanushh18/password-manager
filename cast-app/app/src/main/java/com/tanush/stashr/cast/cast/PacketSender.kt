package com.tanush.stashr.cast.cast

import com.tanush.stashr.cast.core.Logic
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * One writer thread for the socket, with a short queue in front of it. Video deltas that would make the picture lag are dropped
 * (see Logic.Backpressure); codec config, key frames and pings always go. Audio chunks are dropped when the queue is long.
 */
class PacketSender(out: OutputStream, bitrateBps: Int, private val onError: (Exception) -> Unit) {
    private class Item(val type: Int, val pts: Long, val data: ByteArray)

    private val q = LinkedBlockingQueue<Item>()
    private val queuedBytes = AtomicInteger()
    private val out = BufferedOutputStream(out, 64 * 1024)
    private val bp = Logic.Backpressure(bitrateBps)
    @Volatile private var running = true
    val sentBytes = AtomicLong()
    val droppedVideo = AtomicInteger()
    @Volatile var lastWriteAt = System.currentTimeMillis(); private set

    private val thread = Thread({
        try {
            while (running) {
                val it = q.take()
                queuedBytes.addAndGet(-it.data.size)
                Logic.writePacket(out, it.type, it.pts, it.data)
                // video and pings go out at once; audio rides along with the next flush a few ms later
                if (it.type != Logic.T_AUDIO || q.isEmpty()) out.flush()
                sentBytes.addAndGet(it.data.size + 13L)
                lastWriteAt = System.currentTimeMillis()
            }
        } catch (e: InterruptedException) {
            // stopped
        } catch (e: Exception) {
            if (running) onError(e)
        }
    }, "cast-writer").apply { isDaemon = true; priority = Thread.MAX_PRIORITY - 1 }

    fun start() { thread.start() }

    fun stop() { running = false; thread.interrupt() }

    /** Codec config and pings: always queued. */
    fun control(type: Int, pts: Long, data: ByteArray) = put(type, pts, data)

    /** A video frame. Returns false when it was dropped (the caller should ask the encoder for a key frame). */
    fun video(isKey: Boolean, pts: Long, data: ByteArray): Boolean {
        if (q.size > 120) { droppedVideo.incrementAndGet(); return false }       // the link is stuck: let the watchdog end it
        if (!bp.admit(isKey, q.size, queuedBytes.get())) { droppedVideo.incrementAndGet(); return false }
        put(if (isKey) Logic.T_KEY else Logic.T_DELTA, pts, data)
        return true
    }

    fun audio(pts: Long, data: ByteArray): Boolean {
        if (!Logic.admitAudio(q.size)) return false
        put(Logic.T_AUDIO, pts, data)
        return true
    }

    private fun put(type: Int, pts: Long, data: ByteArray) { queuedBytes.addAndGet(data.size); q.put(Item(type, pts, data)) }
}

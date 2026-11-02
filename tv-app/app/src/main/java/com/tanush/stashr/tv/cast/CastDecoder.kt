package com.tanush.stashr.tv.cast

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger

/**
 * H.264 straight onto the screen with the least delay: every access unit is queued the moment it arrives and every decoded
 * frame is shown at once (no timestamps are waited for). If the decoder falls behind, the queue is flushed and the phone
 * is asked for a fresh key frame, so the picture jumps forward instead of lagging.
 */
class CastDecoder(
    private val onSize: (Int, Int) -> Unit,
    private val onNeedKey: () -> Unit
) {
    private val lock = Any()
    private var codec: MediaCodec? = null
    private var config: ByteArray? = null
    private var surface: Surface? = null
    private var hintW = 1280
    private var hintH = 720
    private val inFlight = AtomicInteger(0)
    @Volatile private var waitingForKey = true
    @Volatile private var running = false
    private var outThread: Thread? = null

    fun setConfig(cfg: ByteArray, w: Int, h: Int) = synchronized(lock) {
        if (config != null && config!!.contentEquals(cfg) && codec != null) return@synchronized      // the same parameters again
        config = cfg; hintW = w; hintH = h
        restart()
    }

    fun setSurface(s: Surface?) = synchronized(lock) { surface = s; restart() }

    fun release() = synchronized(lock) { surface = null; stopCodec() }

    private fun restart() {
        stopCodec()
        val cfg = config; val s = surface
        if (cfg == null || s == null || !s.isValid) return
        try {
            val nals = CastLogic.splitAnnexB(cfg)
            val sps = nals.firstOrNull { CastLogic.nalType(it) == 7 }
            val pps = nals.firstOrNull { CastLogic.nalType(it) == 8 }
            val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, hintW, hintH)
            f.setByteBuffer("csd-0", ByteBuffer.wrap(sps ?: cfg))
            if (pps != null) f.setByteBuffer("csd-1", ByteBuffer.wrap(pps))
            f.setInteger(MediaFormat.KEY_MAX_WIDTH, maxOf(hintW, hintH)); f.setInteger(MediaFormat.KEY_MAX_HEIGHT, maxOf(hintW, hintH))
            if (Build.VERSION.SDK_INT >= 23) f.setInteger(MediaFormat.KEY_PRIORITY, 0)
            if (Build.VERSION.SDK_INT >= 30) f.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            val c = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            c.configure(f, s, null, 0)
            c.start()
            codec = c
            inFlight.set(0); waitingForKey = true; running = true
            outThread = Thread({ outputLoop(c) }, "cast-out").also { it.isDaemon = true; it.start() }
            onNeedKey()
        } catch (e: Exception) {
            com.tanush.stashr.tv.core.Health.record("cast", "Could not start the video decoder: " + (e.message ?: e.javaClass.simpleName))
            stopCodec()
        }
    }

    private fun stopCodec() {
        running = false
        val c = codec; codec = null
        try { c?.stop() } catch (e: Exception) { /* already stopped */ }
        try { c?.release() } catch (e: Exception) { /* already released */ }
        outThread = null
    }

    private fun outputLoop(c: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        while (running) {
            try {
                val i = c.dequeueOutputBuffer(info, 10_000)
                when {
                    i >= 0 -> { c.releaseOutputBuffer(i, true); if (inFlight.decrementAndGet() < 0) inFlight.set(0) }
                    i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = c.outputFormat
                        var w = f.getInteger(MediaFormat.KEY_WIDTH); var h = f.getInteger(MediaFormat.KEY_HEIGHT)
                        if (f.containsKey("crop-left") && f.containsKey("crop-right")) w = f.getInteger("crop-right") - f.getInteger("crop-left") + 1
                        if (f.containsKey("crop-top") && f.containsKey("crop-bottom")) h = f.getInteger("crop-bottom") - f.getInteger("crop-top") + 1
                        onSize(w, h)
                    }
                }
            } catch (e: Exception) { break }
        }
    }

    /** One frame from the network. Never blocks. */
    fun feed(data: ByteArray, key: Boolean, ptsUs: Long) {
        synchronized(lock) {
            val c = codec ?: return
            if (!CastLogic.accept(waitingForKey, key, true)) return
            try {
                val idx = c.dequeueInputBuffer(0)
                if (!CastLogic.accept(waitingForKey, key, idx >= 0)) { waitingForKey = true; onNeedKey(); return }
                val buf = c.getInputBuffer(idx) ?: return
                if (data.size > buf.capacity()) { c.queueInputBuffer(idx, 0, 0, ptsUs, 0); waitingForKey = true; onNeedKey(); return }
                buf.clear(); buf.put(data)
                c.queueInputBuffer(idx, 0, data.size, ptsUs, 0)
                if (key) waitingForKey = false
                if (CastLogic.isStale(inFlight.incrementAndGet())) { c.flush(); inFlight.set(0); waitingForKey = true; onNeedKey() }
            } catch (e: Exception) {
                com.tanush.stashr.tv.core.Health.record("cast", "Video decoder error: " + (e.message ?: e.javaClass.simpleName))
                waitingForKey = true; onNeedKey()
            }
        }
    }
}

/** The phone's sound, kept in step with the picture: late sound is thrown away instead of being queued. */
class CastAudio {
    private var track: AudioTrack? = null
    private var written = 0L

    fun start() {
        val rate = 48000
        val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        val size = maxOf(min, rate * 4 * 70 / 1000)
        val b = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build())
            .setBufferSizeInBytes(size).setTransferMode(AudioTrack.MODE_STREAM)
        if (Build.VERSION.SDK_INT >= 26) b.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
        track = b.build().also { it.play() }
        written = 0
    }

    fun write(pcm: ByteArray) {
        val t = track ?: return
        val played = t.playbackHeadPosition.toLong() and 0xFFFFFFFFL
        if (CastLogic.dropAudio(written - played)) return
        val n = t.write(pcm, 0, pcm.size - pcm.size % 4, AudioTrack.WRITE_NON_BLOCKING)
        if (n > 0) written += n / 4
    }

    fun release() {
        val t = track; track = null
        try { t?.stop() } catch (e: Exception) { /* not playing */ }
        try { t?.release() } catch (e: Exception) { /* released */ }
    }
}

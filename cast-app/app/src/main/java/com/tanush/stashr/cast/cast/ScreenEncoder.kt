package com.tanush.stashr.cast.cast

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Surface
import com.tanush.stashr.cast.core.Logic

/**
 * The screen -> H.264 pipeline: a virtual display of the phone's screen draws into the encoder's input surface; a thread
 * takes the encoded pictures out and hands them to the sender. Tuned for delay, not for file size: constant bitrate, no
 * B-frames, realtime priority, low-latency mode where Android has one, and a repeat of the last picture so a still screen
 * keeps sending.
 */
class ScreenEncoder(
    private val projection: MediaProjection,
    private val sender: PacketSender,
    private val bitrate: Int,
    private val fps: Int
) {
    private class Pipe(val codec: MediaCodec, val surface: Surface) { @Volatile var alive = true; var thread: Thread? = null }

    private val main = Handler(Looper.getMainLooper())
    private var vd: VirtualDisplay? = null
    private var pipe: Pipe? = null
    @Volatile private var config: ByteArray = ByteArray(0)
    @Volatile private var lastKeyRequest = 0L
    @Volatile private var stopped = false

    fun start(w: Int, h: Int, dpi: Int) {
        val p = newPipe(w, h)
        pipe = p
        vd = projection.createVirtualDisplay("StashrCast", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, p.surface, null, main)
        drain(p)
    }

    /** The screen turned: a new size needs a new encoder; the virtual display is kept and pointed at it. */
    @Synchronized
    fun resize(w: Int, h: Int, dpi: Int) {
        if (stopped) return
        val old = pipe
        val p = newPipe(w, h)
        pipe = p
        vd?.resize(w, h, dpi)
        vd?.surface = p.surface
        drain(p)
        if (old != null) release(old)
    }

    fun requestKey() {
        val now = System.currentTimeMillis()
        if (now - lastKeyRequest < 300) return
        lastKeyRequest = now
        try {
            pipe?.codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: Exception) { /* encoder is being replaced */ }
    }

    @Synchronized
    fun stop() {
        stopped = true
        try { vd?.release() } catch (_: Exception) { }
        vd = null
        pipe?.let { release(it) }
        pipe = null
    }

    private fun release(p: Pipe) {
        p.alive = false
        try { p.codec.signalEndOfInputStream() } catch (_: Exception) { }
        try { p.thread?.join(300) } catch (_: Exception) { }
        try { p.codec.stop() } catch (_: Exception) { }
        try { p.codec.release() } catch (_: Exception) { }
        try { p.surface.release() } catch (_: Exception) { }
    }

    private fun newPipe(w: Int, h: Int): Pipe {
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            setInteger("max-bframes", 0)
            setInteger(MediaFormat.KEY_PRIORITY, 0)                              // realtime
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000L)       // a still screen still sends
            if (Build.VERSION.SDK_INT >= 30) setInteger("low-latency", 1)
            val caps = try { codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC) } catch (_: Exception) { null }
            if (caps != null && caps.encoderCapabilities.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)) {
                setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
            }
            val high = caps?.profileLevels?.filter { it.profile == MediaCodecInfo.CodecProfileLevel.AVCProfileHigh }
            if (!high.isNullOrEmpty()) {
                setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)
                setInteger(MediaFormat.KEY_LEVEL, high.maxOf { it.level })
            } else {
                val base = caps?.profileLevels?.filter { it.profile == MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline }
                if (!base.isNullOrEmpty()) { setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline); setInteger(MediaFormat.KEY_LEVEL, base.maxOf { it.level }) }
            }
        }
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        } catch (e: Exception) {
            // some encoders refuse a setting (level, priority…): try again with only the basics
            codec.reset()
            val basic = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrate); setInteger(MediaFormat.KEY_FRAME_RATE, fps); setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            }
            codec.configure(basic, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        }
        val surface = codec.createInputSurface()
        codec.start()
        return Pipe(codec, surface)
    }

    private fun drain(p: Pipe) {
        p.thread = Thread({
            val info = MediaCodec.BufferInfo()
            try {
                while (p.alive) {
                    val i = p.codec.dequeueOutputBuffer(info, 20_000)
                    if (i < 0) continue
                    val buf = p.codec.getOutputBuffer(i)
                    if (buf != null && info.size > 0) {
                        buf.position(info.offset); buf.limit(info.offset + info.size)
                        val data = ByteArray(info.size); buf.get(data)
                        handle(info, data)
                    }
                    p.codec.releaseOutputBuffer(i, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            } catch (_: Exception) {
                // the encoder was stopped or replaced
            }
        }, "cast-encoder").apply { isDaemon = true; priority = Thread.MAX_PRIORITY - 1; start() }
    }

    private fun handle(info: MediaCodec.BufferInfo, data: ByteArray) {
        val pts = info.presentationTimeUs
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
            config = data
            sender.control(Logic.T_CONFIG, pts, data)
            return
        }
        val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        if (key && config.isNotEmpty()) sender.control(Logic.T_CONFIG, pts, config)      // the config again before every key frame
        if (!sender.video(key, pts, data)) requestKey()                                  // dropped: ask for a fresh start
    }
}

package com.tanush.stashr.cast.cast

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import androidx.annotation.RequiresApi
import com.tanush.stashr.cast.core.Logic

/** The sound the phone plays (media, games, unspecified), as 20 ms PCM chunks. Needs Android 10 and the microphone permission. */
@RequiresApi(29)
class AudioCapture(private val projection: MediaProjection, private val sender: PacketSender) {
    private var record: AudioRecord? = null
    @Volatile private var running = false
    private var thread: Thread? = null

    /** False when this phone will not give the sound (the video goes on without it). */
    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        return try {
            val cfg = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build()
            val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(Logic.AUDIO_RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build()
            val min = AudioRecord.getMinBufferSize(Logic.AUDIO_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
            val r = AudioRecord.Builder().setAudioFormat(format).setAudioPlaybackCaptureConfig(cfg).setBufferSizeInBytes(maxOf(min, Logic.AUDIO_CHUNK_BYTES * 8)).build()
            if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
            r.startRecording()
            record = r
            running = true
            thread = Thread({
                val buf = ByteArray(Logic.AUDIO_CHUNK_BYTES)
                try {
                    while (running) {
                        var got = 0
                        while (got < buf.size && running) { val n = r.read(buf, got, buf.size - got); if (n <= 0) { Thread.sleep(5); continue }; got += n }
                        if (got == buf.size) sender.audio(System.nanoTime() / 1000, buf.copyOf())
                    }
                } catch (_: Exception) { /* stopped */ }
            }, "cast-audio").apply { isDaemon = true; priority = Thread.MAX_PRIORITY - 1; start() }
            true
        } catch (e: Exception) { false }
    }

    fun stop() {
        running = false
        try { record?.stop() } catch (_: Exception) { }
        try { record?.release() } catch (_: Exception) { }
        record = null
    }
}

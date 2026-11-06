package com.tanush.stashr.hub.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Handler
import android.os.Looper
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/**
 * The tablet camera as a motion alarm. While armed, a small grey grid of each frame (about three a second) is compared
 * with a slowly updated picture of the empty room; when enough of the grid changes in two frames in a row, a photo goes
 * to Stashr (and on to Telegram), then a 10 second clip if clips are on. At most one alert a minute.
 *
 * The camera is only open while it is needed: armed, or taking a photo or clip on request.
 */
object CameraWatch {
    private const val GRID_W = 32
    private const val GRID_H = 24
    private const val COOLDOWN_MS = 60_000L
    private const val FRAME_GAP_MS = 330L
    private const val CLIP_MS = 10_000L
    private const val MOTION_EXTEND_MS = 10_000L
    private const val MAX_CLIP_MS = 60_000L
    private const val LIVE_GAP_MS = 1_500L
    private const val WARMUP_FRAMES = 6

    private var service: LifecycleService? = null
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var bound = false
    private var scope: CoroutineScope? = null
    private var analyzerExecutor: ExecutorService? = null
    private val main = Handler(Looper.getMainLooper())

    private val pendingSnapshot = AtomicBoolean(false)
    private val recording = AtomicBoolean(false)
    private var activeRecording: Recording? = null
    @Volatile private var recordReason = ""
    @Volatile private var recordStartedAt = 0L
    @Volatile private var recordUntil = 0L

    // Live view: frames go to the Smart home page until this time.
    @Volatile private var liveUntil = 0L
    private var lastLiveAt = 0L
    private val liveBusy = AtomicBoolean(false)

    @Volatile private var clipsSupported = true
    @Volatile private var lastMotion: Long = 0L
    @Volatile private var error: String = ""
        set(v) {
            field = v
            // A missing permission is shown by the permission checklist; everything else is worth remembering.
            if (v.isNotEmpty() && !v.startsWith("Allow the camera")) com.tanush.stashr.hub.core.Health.note("camera", v)
        }

    // Motion state, touched only on the analyzer thread.
    private var background: FloatArray? = null
    private var lastFrameAt = 0L
    private var warmup = 0
    private var hits = 0

    private fun ctx(): Context? = service

    fun start(service: LifecycleService) {
        this.service = service
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        analyzerExecutor = Executors.newSingleThreadExecutor()
        if (Prefs(service).cameraArmed) main.post { ensureBound() }
    }

    fun stop() {
        main.post {
            try { activeRecording?.stop() } catch (_: Exception) {}
            activeRecording = null
            unbind()
            scope?.cancel(); scope = null
            analyzerExecutor?.shutdown(); analyzerExecutor = null
            service = null
        }
    }

    fun arm() {
        val c = ctx() ?: return
        Prefs(c).cameraArmed = true
        resetMotion()
        main.post { ensureBound() }
    }

    fun disarm() {
        val c = ctx() ?: return
        Prefs(c).cameraArmed = false
        main.post { releaseIfIdle() }
    }

    fun snapshot() {
        pendingSnapshot.set(true)
        main.post { ensureBound() }
    }

    fun clip() {
        main.post {
            if (ensureBound()) startClip("clip")
        }
    }

    /**
     * Live view from the Stashr page: for this many seconds, a small photo about every 1.5 s goes to the server, which
     * the page shows like a security camera. Calling it again extends the window.
     */
    fun live(seconds: Int = 120) {
        val ms = seconds.coerceIn(10, 600) * 1000L
        liveUntil = maxOf(liveUntil, System.currentTimeMillis() + ms)
        main.post {
            ensureBound()
            main.postDelayed({ releaseIfIdle() }, ms + 1_000L)
        }
    }

    /** Settings from the Smart home page (sent with the dashboard). */
    fun applyConfig(sensitivity: Int, video: Boolean) {
        val c = ctx() ?: return
        val p = Prefs(c)
        p.cameraSensitivity = sensitivity.coerceIn(1, 10)
        p.cameraVideo = video
    }

    fun status(): JSONObject {
        val c = ctx()
        val armed = c != null && Prefs(c).cameraArmed
        return JSONObject()
            .put("armed", armed)
            .put("lastMotion", if (lastMotion > 0) lastMotion else JSONObject.NULL)
            .put("clips", clipsSupported)
            .put("live", System.currentTimeMillis() < liveUntil)
            .put("recording", recording.get())
            .put("error", error)
    }

    /* ───────── binding (main thread) ───────── */

    private fun hasPermission(c: Context) = ContextCompat.checkSelfPermission(c, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    /** Opens the camera if it is not open yet. Returns true when it is (or is about to be) open. */
    private fun ensureBound(): Boolean {
        val svc = service ?: return false
        if (!hasPermission(svc)) { error = "Allow the camera for Stashr Hub"; pendingSnapshot.set(false); return false }
        if (bound) return true
        val p = provider
        if (p == null) {
            val future = ProcessCameraProvider.getInstance(svc)
            future.addListener({
                try {
                    provider = future.get()
                    bind()
                } catch (e: Exception) {
                    error = "Camera is not available: ${e.message ?: e.javaClass.simpleName}"
                }
            }, ContextCompat.getMainExecutor(svc))
            return true
        }
        bind()
        return bound
    }

    private fun bind() {
        val svc = service ?: return
        val p = provider ?: return
        if (bound) return
        val selector = when {
            // The front (selfie) camera first: the tablet stands facing the room. The back camera is only the fallback.
            safeHas(p, CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
            safeHas(p, CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
            else -> { error = "This device has no camera"; return }
        }
        val a = ImageAnalysis.Builder()
            .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
        val exec = analyzerExecutor ?: Executors.newSingleThreadExecutor().also { analyzerExecutor = it }
        a.setAnalyzer(exec) { image -> analyze(image) }
        val recorder = Recorder.Builder()
            .setQualitySelector(QualitySelector.fromOrderedList(listOf(Quality.SD, Quality.HD), FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)))
            .build()
        val v = VideoCapture.withOutput(recorder)
        try {
            p.unbindAll()
            p.bindToLifecycle(svc, selector, a, v)
            videoCapture = v
            clipsSupported = true
            error = ""
        } catch (e: Exception) {
            try {
                p.unbindAll()
                p.bindToLifecycle(svc, selector, a)
                videoCapture = null
                clipsSupported = false
                error = "Clips are not supported on this camera; photos still work"
            } catch (e2: Exception) {
                error = "Could not open the camera: ${e2.message ?: e2.javaClass.simpleName}"
                return
            }
        }
        analysis = a
        bound = true
        resetMotion()
    }

    private fun safeHas(p: ProcessCameraProvider, s: CameraSelector) = try { p.hasCamera(s) } catch (_: Exception) { false }

    private fun unbind() {
        try { provider?.unbindAll() } catch (_: Exception) {}
        analysis?.clearAnalyzer()
        analysis = null
        videoCapture = null
        bound = false
    }

    /** Closes the camera when nothing needs it: not armed, no photo or clip in progress. */
    private fun releaseIfIdle() {
        val c = ctx() ?: return
        if (!Prefs(c).cameraArmed && !pendingSnapshot.get() && !recording.get() && System.currentTimeMillis() >= liveUntil) unbind()
    }

    private fun resetMotion() {
        analyzerExecutor?.execute { background = null; warmup = 0; hits = 0 }
    }

    /* ───────── frames (analyzer thread) ───────── */

    private fun analyze(image: ImageProxy) {
        try {
            val c = ctx() ?: return
            if (pendingSnapshot.compareAndSet(true, false)) {
                val jpeg = toJpeg(image)
                upload("photo", "snapshot", jpeg)
                main.post { releaseIfIdle() }
            }
            val now = System.currentTimeMillis()
            if (now < liveUntil && now - lastLiveAt >= LIVE_GAP_MS && liveBusy.compareAndSet(false, true)) {
                lastLiveAt = now
                try { uploadLive(smallJpeg(toJpeg(image))) } catch (e: Exception) { liveBusy.set(false) }
            }
            val prefs = Prefs(c)
            if (!prefs.cameraArmed) return
            if (now - lastFrameAt < FRAME_GAP_MS) return
            lastFrameAt = now
            val grid = lumaGrid(image)
            val bg = background
            if (bg == null || warmup < WARMUP_FRAMES) {
                background = if (bg == null) grid else blend(bg, grid, 0.5f)
                warmup++
                return
            }
            val moved = changedFraction(bg, grid, prefs.cameraSensitivity)
            // The empty room is learned slowly, so a person standing still is still "new" for a while.
            background = blend(bg, grid, if (moved.first) 0.02f else 0.06f)
            hits = if (moved.first) hits + 1 else 0
            // Still moving while a motion clip records: keep recording (10 s more each time, a minute at most).
            if (moved.first && recording.get() && recordReason == "motion") {
                recordUntil = minOf(now + MOTION_EXTEND_MS, recordStartedAt + MAX_CLIP_MS)
            }
            if (hits >= 2 && now - lastMotion > COOLDOWN_MS) {
                hits = 0
                lastMotion = now
                val jpeg = toJpeg(image)
                upload("photo", "motion", jpeg)
                if (prefs.cameraVideo && clipsSupported) main.post { startClip("motion") }
            }
        } catch (e: Exception) {
            error = "Camera: ${e.message ?: e.javaClass.simpleName}"
        } finally {
            image.close()
        }
    }

    /** The average brightness of a 32×24 grid of cells, from the Y plane. */
    private fun lumaGrid(image: ImageProxy): FloatArray {
        val plane = image.planes[0]
        val buf = plane.buffer
        val rowStride = plane.rowStride
        val pixStride = plane.pixelStride
        val w = image.width
        val h = image.height
        val out = FloatArray(GRID_W * GRID_H)
        val cellW = w / GRID_W
        val cellH = h / GRID_H
        for (gy in 0 until GRID_H) {
            for (gx in 0 until GRID_W) {
                var sum = 0
                var n = 0
                // 3×3 samples per cell are plenty to tell a person from noise.
                for (sy in 0 until 3) {
                    val y = gy * cellH + (sy * 2 + 1) * cellH / 6
                    for (sx in 0 until 3) {
                        val x = gx * cellW + (sx * 2 + 1) * cellW / 6
                        val idx = y * rowStride + x * pixStride
                        if (idx < buf.limit()) { sum += buf.get(idx).toInt() and 0xff; n++ }
                    }
                }
                out[gy * GRID_W + gx] = if (n > 0) sum.toFloat() / n else 0f
            }
        }
        return out
    }

    private fun blend(bg: FloatArray, cur: FloatArray, rate: Float): FloatArray =
        FloatArray(bg.size) { i -> bg[i] * (1 - rate) + cur[i] * rate }

    /**
     * Whether enough of the picture changed. A light switched on brightens every cell alike, so the overall change in
     * brightness is taken out first. Sensitivity 10 reacts to about 2% of the picture, 1 needs about a quarter.
     */
    private fun changedFraction(bg: FloatArray, cur: FloatArray, sensitivity: Int): Pair<Boolean, Float> {
        val s = sensitivity.coerceIn(1, 10)
        val offset = (cur.average() - bg.average()).toFloat()
        val pixelThreshold = 18f + (10 - s) * 2f
        var changed = 0
        for (i in cur.indices) if (abs(cur[i] - offset - bg[i]) > pixelThreshold) changed++
        val fraction = changed.toFloat() / cur.size
        val needed = 0.27f - 0.025f * s
        return (fraction >= needed) to fraction
    }

    /** A light copy for live view: the long side 640 px, quality 60. */
    private fun smallJpeg(jpeg: ByteArray): ByteArray {
        val bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return jpeg
        val long = maxOf(bmp.width, bmp.height)
        val scaled = if (long > 640) Bitmap.createScaledBitmap(bmp, bmp.width * 640 / long, bmp.height * 640 / long, true) else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 60, out)
        if (scaled !== bmp) scaled.recycle()
        bmp.recycle()
        return out.toByteArray()
    }

    private fun uploadLive(bytes: ByteArray) {
        val c = ctx()
        val s = scope
        if (c == null || s == null) { liveBusy.set(false); return }
        s.launch {
            try { Api(c).uploadLive(bytes) }
            catch (e: Exception) { error = "Live view upload failed: ${e.message ?: e.javaClass.simpleName}" }
            finally { liveBusy.set(false) }
        }
    }

    /** YUV_420_888 → NV21 → JPEG, turned the right way up. */
    private fun toJpeg(image: ImageProxy): ByteArray {
        val w = image.width
        val h = image.height
        val nv21 = ByteArray(w * h * 3 / 2)
        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]
        var pos = 0
        val yBuf = yPlane.buffer
        for (row in 0 until h) {
            val base = row * yPlane.rowStride
            if (yPlane.pixelStride == 1) {
                yBuf.position(base)
                yBuf.get(nv21, pos, w)
                pos += w
            } else {
                for (col in 0 until w) nv21[pos++] = yBuf.get(base + col * yPlane.pixelStride)
            }
        }
        val uBuf = uPlane.buffer
        val vBuf = vPlane.buffer
        for (row in 0 until h / 2) {
            for (col in 0 until w / 2) {
                val vi = row * vPlane.rowStride + col * vPlane.pixelStride
                val ui = row * uPlane.rowStride + col * uPlane.pixelStride
                nv21[pos++] = if (vi < vBuf.limit()) vBuf.get(vi) else 0
                nv21[pos++] = if (ui < uBuf.limit()) uBuf.get(ui) else 0
            }
        }
        val out = ByteArrayOutputStream()
        YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 85, out)
        val jpeg = out.toByteArray()
        val rotation = image.imageInfo.rotationDegrees
        if (rotation == 0) return jpeg
        val bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return jpeg
        val turned = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
        val out2 = ByteArrayOutputStream()
        turned.compress(Bitmap.CompressFormat.JPEG, 85, out2)
        if (turned !== bmp) turned.recycle()
        bmp.recycle()
        return out2.toByteArray()
    }

    /* ───────── clips (main thread) ───────── */

    @SuppressLint("MissingPermission") // audio is never enabled
    private fun startClip(reason: String) {
        val svc = service ?: return
        val v = videoCapture
        if (v == null) { if (!clipsSupported) error = "Clips are not supported on this camera; photos still work"; return }
        if (!recording.compareAndSet(false, true)) return
        val started = System.currentTimeMillis()
        recordReason = reason
        recordStartedAt = started
        recordUntil = started + if (reason == "motion") MOTION_EXTEND_MS else CLIP_MS
        val file = File(svc.cacheDir, "clip-$started.mp4")
        try {
            activeRecording = v.output
                .prepareRecording(svc, FileOutputOptions.Builder(file).build())
                .start(ContextCompat.getMainExecutor(svc)) { event ->
                    if (event is VideoRecordEvent.Finalize) {
                        activeRecording = null
                        recording.set(false)
                        if (!event.hasError() || event.error == VideoRecordEvent.Finalize.ERROR_NONE) {
                            val s = scope
                            if (s != null) s.launch {
                                try {
                                    if (file.length() > 0) Api(svc).uploadMedia("video", reason, file.readBytes())
                                } catch (e: Exception) {
                                    if (com.tanush.stashr.hub.local.MediaQueue.worthKeeping(e) && file.length() > 0) { try { com.tanush.stashr.hub.local.MediaQueue.enqueue(svc, "video", reason, file.readBytes()) } catch (x: Exception) { } }
                                    error = "Clip upload failed: ${e.message ?: e.javaClass.simpleName}"
                                } finally { file.delete() }
                            } else file.delete()
                        } else {
                            error = "Clip recording failed (code ${event.error})"
                            file.delete()
                        }
                        releaseIfIdle()
                    }
                }
            // Stops when the time is up; motion pushes recordUntil later (see analyze), up to a minute.
            val check = object : Runnable {
                override fun run() {
                    if (!recording.get()) return
                    val now = System.currentTimeMillis()
                    if (now >= recordUntil || now - started >= MAX_CLIP_MS) { try { activeRecording?.stop() } catch (_: Exception) {} }
                    else main.postDelayed(this, 500L)
                }
            }
            main.postDelayed(check, 500L)
        } catch (e: Exception) {
            recording.set(false)
            activeRecording = null
            file.delete()
            error = "Could not record a clip: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    private fun upload(kind: String, reason: String, bytes: ByteArray) {
        val c = ctx() ?: return
        val s = scope ?: return
        s.launch {
            try { Api(c).uploadMedia(kind, reason, bytes) }
            catch (e: Exception) {
                if (com.tanush.stashr.hub.local.MediaQueue.worthKeeping(e)) com.tanush.stashr.hub.local.MediaQueue.enqueue(c, kind, reason, bytes)
                error = "Photo upload failed: ${e.message ?: e.javaClass.simpleName}"
            }
        }
    }
}

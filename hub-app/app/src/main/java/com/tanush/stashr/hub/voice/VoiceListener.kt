package com.tanush.stashr.hub.voice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.core.content.ContextCompat
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Prefs
import java.util.Locale
import kotlin.concurrent.thread

/**
 * "Hey Stashr": keeps Android's speech recognizer listening in a loop on the tablet. When a sentence starts with the
 * wake word, the rest of it ("hey stashr, tv ki awaaz kam karo") goes to Stashr's assistant, the reply is spoken,
 * and the dashboard is told what was heard. "Hey Stashr" alone opens a second listen for the command.
 * Some recognizers beep at every start; that is Android's and is left as it is.
 */
object VoiceListener {
    const val ACTION_VOICE = "com.tanush.stashr.hub.VOICE"
    private val WAKE = listOf("hey stashr", "hey stasher", "hey stash", "hi stashr", "hi stasher", "stashr", "stasher", "stash", "स्टैशर", "स्टेशर", "स्टाशर", "हे स्टैशर")

    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    @Volatile private var active = false
    private var awaitingCommand = false
    private var failures = 0
    @Volatile private var lastStatus = "off"

    fun start(ctx: Context) {
        val c = ctx.applicationContext
        main.post {
            app = c
            if (!Prefs(c).voiceOn) { lastStatus = "off"; return@post }
            if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { lastStatus = "no microphone permission"; return@post }
            if (!SpeechRecognizer.isRecognitionAvailable(c)) { lastStatus = "not available"; return@post }
            if (active) return@post
            active = true
            lastStatus = "on"
            if (tts == null) tts = TextToSpeech(c) { ok -> if (ok == TextToSpeech.SUCCESS) pickVoice() }
            listen()
        }
    }

    fun stop() {
        main.post {
            active = false
            main.removeCallbacksAndMessages(null)
            try { recognizer?.cancel(); recognizer?.destroy() } catch (e: Exception) { }
            recognizer = null
            lastStatus = "off"
        }
    }

    /** "on", "off", "no microphone permission", "not available" */
    fun status(): String = lastStatus

    private fun pickVoice() {
        val t = tts ?: return
        val hi = Locale("hi", "IN")
        if (t.isLanguageAvailable(hi) >= TextToSpeech.LANG_AVAILABLE) t.language = hi else t.language = Locale.ENGLISH
    }

    private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "hi-IN")
        putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", arrayOf("en-IN"))
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, app?.packageName)
    }

    private fun listen() {
        val c = app ?: return
        if (!active) return
        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(c).apply { setRecognitionListener(listener) }
            }
            recognizer?.startListening(intent())
        } catch (e: Exception) { retry() }
    }

    private fun retry(delayMs: Long? = null) {
        if (!active) return
        val wait = delayMs ?: (minOf(30_000L, 500L shl minOf(failures, 6)))
        main.postDelayed({ listen() }, wait)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onError(error: Int) {
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> { failures = 0; awaitingCommand = false; retry(250) }
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> { lastStatus = "no microphone permission"; active = false }
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                    failures++
                    try { recognizer?.destroy() } catch (e: Exception) { }
                    recognizer = null
                    retry()
                }
                else -> { failures++; retry() }
            }
        }

        override fun onResults(results: Bundle?) {
            failures = 0
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
            if (awaitingCommand) {
                awaitingCommand = false
                val cmd = heard.firstOrNull()?.trim().orEmpty()
                if (cmd.isNotEmpty()) send(cmd)
                retry(400)
                return
            }
            for (h in heard) {
                val command = afterWake(h) ?: continue
                if (command.isEmpty()) {
                    awaitingCommand = true
                    speak("Haan?")
                    retry(900)
                } else {
                    send(command)
                    retry(400)
                }
                return
            }
            retry(150)
        }
    }

    /** The words after the wake word, "" for the wake word alone, or null when the sentence has no wake word. */
    fun afterWake(sentence: String): String? {
        val s = sentence.lowercase(Locale.ROOT).trim()
        for (w in WAKE) {
            val i = s.indexOf(w)
            if (i < 0) continue
            // "stash" must be a word of its own, not part of "stashed".
            val end = i + w.length
            if (end < s.length && s[end].isLetter() && w == "stash") continue
            return s.substring(end).trim().trimStart(',', '.', '!', ' ')
        }
        return null
    }

    private fun send(text: String) {
        val c = app ?: return
        thread {
            val reply = try { Api(c).assistant(text).optString("reply", "Done.") } catch (e: Exception) { e.message ?: "Could not reach Stashr." }
            c.sendBroadcast(Intent(ACTION_VOICE).setPackage(c.packageName).putExtra("heard", text).putExtra("reply", reply))
            main.post { speak(reply) }
        }
    }

    private fun speak(s: String) {
        try { tts?.speak(s, TextToSpeech.QUEUE_FLUSH, null, "stashr-" + System.currentTimeMillis()) } catch (e: Exception) { }
    }
}

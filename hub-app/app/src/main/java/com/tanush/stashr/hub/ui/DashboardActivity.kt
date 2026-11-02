package com.tanush.stashr.hub.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.tanush.stashr.hub.camera.CameraWatch
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.HubService
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.core.Ui
import com.tanush.stashr.hub.update.Updater
import com.tanush.stashr.hub.voice.VoiceListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The tablet's home screen, in the Stashr look: a big clock and the weather, who is home, the TV, today's TV time and
 * internet speed, what happened, scene buttons, and "Ask Stashr" by voice or typing. It stays on; after 10 idle
 * minutes it turns into the photo slideshow when a folder is set on the Smart home page.
 */
class DashboardActivity : Activity() {
    private lateinit var ui: Ui
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs by lazy { Prefs(this) }

    private lateinit var clock: TextView
    private lateinit var date: TextView
    private lateinit var weather: TextView
    private lateinit var people: LinearLayout
    private lateinit var tv: LinearLayout
    private lateinit var today: LinearLayout
    private lateinit var events: LinearLayout
    private lateinit var scenes: LinearLayout
    private lateinit var reply: TextView
    private lateinit var statusLine: TextView
    private lateinit var cameraSwitch: Switch
    private lateinit var voiceSwitch: Switch
    private lateinit var micButton: TextView
    private lateinit var waState: TextView
    private lateinit var waResult: TextView

    private var slideshowReady = false
    private var lastTouch = System.currentTimeMillis()
    private var resumed = false
    private var oneShot: SpeechRecognizer? = null
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())

    private val voiceReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            showReply(i.getStringExtra("heard").orEmpty(), i.getStringExtra("reply").orEmpty())
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ui = Ui(this)
        HubService.start(this)
        setContentView(build())
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(voiceReceiver, IntentFilter(VoiceListener.ACTION_VOICE), Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(voiceReceiver, IntentFilter(VoiceListener.ACTION_VOICE))
        }
        askPermissions()
        tick()
        refresh()
    }

    /* ───────── layout ───────── */

    private fun build(): View {
        val (root, col) = ui.page()
        val wide = resources.configuration.screenWidthDp >= 900

        val head = ui.row(12)
        val titles = ui.column(2)
        titles.addView(ui.eyebrow("Stashr Hub · " + prefs.deviceName.ifEmpty { "Home" }))
        titles.addView(ui.h1("Your home"))
        head.addView(ui.fill(titles))
        col.addView(head)

        val left = ui.column(12)
        val right = ui.column(12)

        // Clock and weather
        val clockCard = ui.card()
        clock = ui.text("--:--", 64f, ui.c.text, bold = true)
        date = ui.text("", 16f, ui.c.muted)
        weather = ui.body("")
        clockCard.addView(clock); clockCard.addView(date); clockCard.addView(weather)
        left.addView(clockCard)

        // Ask Stashr
        val ask = ui.card("Ask Stashr", "Say “Hey Stashr, …” any time, or tap the mic. Hindi or English.")
        val askRow = ui.row(8)
        val input = ui.input("tv ki awaaz kam karo, arijit ke gaane chalao…")
        input.imeOptions = EditorInfo.IME_ACTION_SEND
        input.setSingleLine()
        val send = ui.primary("Send") { val t = input.text.toString(); input.setText(""); ask(t) }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { send.performClick(); true } else false }
        micButton = ui.quiet("🎤 Speak") { listenOnce() }
        askRow.addView(ui.fill(input)); askRow.addView(micButton); askRow.addView(send)
        ask.addView(askRow)
        reply = ui.text("", 15f, ui.c.text, bold = true).apply { visibility = View.GONE }
        ask.addView(reply)
        left.addView(ask)

        // Scenes
        val sceneCard = ui.card("Scenes", "One tap runs several commands")
        scenes = ui.row(8)
        sceneCard.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(scenes) })
        left.addView(sceneCard)

        // Who is home
        val peopleCard = ui.card("Who is home")
        people = ui.column(6)
        peopleCard.addView(people)
        right.addView(peopleCard)

        // TV
        val tvCard = ui.card("TV")
        tv = ui.column(6)
        tvCard.addView(tv)
        right.addView(tvCard)

        // Today
        val todayCard = ui.card("Today")
        today = ui.column(6)
        todayCard.addView(today)
        right.addView(todayCard)

        // What happened
        val evCard = ui.card("What happened")
        events = ui.column(8)
        evCard.addView(events)
        right.addView(evCard)

        // This tablet
        val ctl = ui.card("This tablet")
        statusLine = ui.dim("")
        ctl.addView(statusLine)
        cameraSwitch = switch("Camera alerts: send a photo when someone comes into view", prefs.cameraArmed) { on ->
            if (on) CameraWatch.arm() else CameraWatch.disarm()
        }
        voiceSwitch = switch("Listen for “Hey Stashr”", prefs.voiceOn) { on ->
            prefs.voiceOn = on
            if (on) VoiceListener.start(this) else VoiceListener.stop()
        }
        ctl.addView(cameraSwitch); ctl.addView(voiceSwitch)
        val buttons = ui.row(8)
        buttons.addView(ui.quiet("Slideshow") { startActivity(Intent(this, SlideshowActivity::class.java)) })
        buttons.addView(ui.quiet("Check for update") {
            scope.launch {
                statusLine.text = "Checking for an update…"
                val msg = try { Updater.check(this@DashboardActivity, manual = true) } catch (e: Exception) { e.message ?: "Update check failed" }
                statusLine.text = msg
            }
        })
        buttons.addView(ui.danger("Unpair") { unpair() })
        ctl.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(buttons) })
        left.addView(ctl)

        // WhatsApp messages
        val wa = ui.card("WhatsApp messages", "Lets Stashr send “arrived / left” to a WhatsApp group from this tablet")
        waState = ui.body("")
        wa.addView(waState)
        wa.addView(ui.dim("Needs: WhatsApp signed in here, Stashr Hub switched on in Accessibility, and no lock-screen PIN (swipe or none). On Android 13+ for an app installed from a file: Settings → Apps → Stashr Hub → ⋮ → Allow restricted settings, then turn it on."))
        wa.addView(ui.quiet("Open Accessibility settings") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
        val waGroup = ui.input("WhatsApp group name")
        val waText = ui.input("Message", "Reached office")
        wa.addView(waGroup); wa.addView(waText)
        waResult = ui.dim("")
        wa.addView(ui.primary("Send a test message") {
            waResult.text = "Sending…"
            scope.launch {
                waResult.text = try { com.tanush.stashr.hub.whatsapp.WhatsAppSender.send(this@DashboardActivity, waGroup.text.toString(), waText.text.toString()) } catch (e: Exception) { e.message ?: "Failed" }
            }
        })
        wa.addView(waResult)
        left.addView(wa)

        if (wide) {
            val two = ui.row(16)
            two.gravity = android.view.Gravity.TOP
            two.addView(left, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            two.addView(right, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            col.addView(two)
        } else {
            col.addView(left); col.addView(right)
        }
        return root
    }

    @SuppressLint("UseSwitchCompatOrMaterialCode")
    private fun switch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) = Switch(this).apply {
        text = label; isChecked = checked; setTextColor(ui.c.text); textSize = 15f
        minHeight = ui.dp(44)
        setOnCheckedChangeListener { _, on -> onChange(on) }
    }

    /* ───────── data ───────── */

    private fun tick() {
        clock.text = clockFmt.format(Date())
        date.text = dateFmt.format(Date())
        val ago = if (HubService.lastReport > 0) agoText(HubService.lastReport) else "not yet"
        val err = HubService.lastError
        statusLine.text = buildString {
            append("Reported to Stashr: ").append(ago)
            if (err.isNotEmpty()) append(" · problem: ").append(err)
            append(" · camera ").append(if (prefs.cameraArmed) "watching" else "off")
            append(" · voice ").append(VoiceListener.status())
            if (Updater.waiting) append(" · an update is waiting for your tap")
        }
        waState.text = if (com.tanush.stashr.hub.whatsapp.WhatsAppSender.serviceOn()) "● Accessibility is on: ready" else "○ Accessibility is off"
        if (cameraSwitch.isChecked != prefs.cameraArmed) cameraSwitch.isChecked = prefs.cameraArmed
        if (slideshowReady && resumed && System.currentTimeMillis() - lastTouch > 10 * 60_000) {
            lastTouch = System.currentTimeMillis()
            startActivity(Intent(this, SlideshowActivity::class.java))
        }
        main.postDelayed({ tick() }, 5_000)
    }

    private fun refresh() {
        thread {
            try {
                val d = Api(this).dashboard()
                main.post { render(d) }
            } catch (e: Exception) {
                main.post { if (weather.text.isEmpty()) weather.text = "Could not reach Stashr: ${e.message}" }
            }
        }
        main.postDelayed({ refresh() }, 30_000)
    }

    private fun render(d: JSONObject) {
        val w = d.optJSONObject("weather")
        weather.text = if (w != null) "${w.optString("city").substringBefore(",")}  ${w.optInt("temp")}°C · ${w.optString("text")} · ${w.optInt("min")}–${w.optInt("max")}°C" +
            (if (!w.isNull("rainChance")) " · ${w.optInt("rainChance")}% rain" else "") else "Set your city on the Smart home page for the weather."

        people.removeAllViews()
        val ps = d.optJSONArray("people") ?: JSONArray()
        if (ps.length() == 0) people.addView(ui.dim("Give a Wi-Fi device a person on the Smart home page, or pair a family phone."))
        else {
            val row = ui.row(6)
            for (i in 0 until ps.length()) {
                val p = ps.getJSONObject(i)
                val home = p.optBoolean("home")
                row.addView(ui.chip((if (home) "● " else "○ ") + p.optString("person") + if (home) " · home" else " · out", if (home) ui.c.ok else null))
            }
            people.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(row) })
        }

        tv.removeAllViews()
        val tvs = d.optJSONArray("tvs") ?: JSONArray()
        if (tvs.length() == 0) tv.addView(ui.dim("No TV yet."))
        for (i in 0 until tvs.length()) {
            val t = tvs.getJSONObject(i)
            val line = ui.row(8)
            val on = t.optBoolean("online") && t.optString("screen") != "off"
            line.addView(ui.dot(if (on) ui.c.ok else if (t.optBoolean("online")) ui.c.warn else ui.c.faint))
            val what = when {
                !t.optBoolean("online") -> "off"
                !on -> "standby"
                t.optString("title").isNotEmpty() -> t.optString("title") + (if (t.optString("app").isNotEmpty()) " · " + t.optString("app") else "")
                t.optString("app").isNotEmpty() -> t.optString("app")
                else -> "on"
            }
            line.addView(ui.body("${t.optString("name")}: $what"))
            tv.addView(line)
        }

        today.removeAllViews()
        val mins = d.optInt("tvMinutesToday")
        today.addView(ui.body("📺 TV today: " + if (mins >= 60) "${mins / 60} h ${mins % 60} min" else "$mins min"))
        val sp = d.optJSONObject("speed")
        today.addView(ui.body(if (sp != null) "🚀 Internet: ${sp.optDouble("down")} Mbit/s down · ${sp.optDouble("up")} up · ${sp.optInt("ping")} ms" else "🚀 Internet: first speed test soon"))

        events.removeAllViews()
        val ev = d.optJSONArray("events") ?: JSONArray()
        if (ev.length() == 0) events.addView(ui.dim("Nothing yet."))
        for (i in 0 until minOf(ev.length(), 8)) {
            val e = ev.getJSONObject(i)
            val row = ui.row(10)
            row.gravity = android.view.Gravity.TOP
            val at = try { Instant.parse(e.optString("at")).toEpochMilli() } catch (x: Exception) { 0L }
            row.addView(ui.text(if (at > 0) agoText(at) else "", 12f, ui.c.faint).apply { minWidth = ui.dp(72) })
            row.addView(ui.fill(ui.body(e.optString("text"))))
            events.addView(row)
        }

        scenes.removeAllViews()
        val sc = d.optJSONArray("scenes") ?: JSONArray()
        for (i in 0 until sc.length()) {
            val s = sc.getJSONObject(i)
            scenes.addView(ui.primary(s.optString("name")) { runScene(s.optString("id"), s.optString("name")) })
        }

        val cfg = d.optJSONObject("config")
        val cam = cfg?.optJSONObject("camera")
        if (cam != null) CameraWatch.applyConfig(cam.optInt("sensitivity", 5), cam.optBoolean("video", true))
        slideshowReady = cfg?.optBoolean("slideshow") == true
    }

    private fun runScene(id: String, name: String) {
        thread {
            val msg = try { val n = Api(this).runScene(id).optInt("sent"); if (n > 0) "$name: sent $n command${if (n > 1) "s" else ""}." else "$name: no device is ready." } catch (e: Exception) { e.message ?: "Could not run it." }
            main.post { showReply("", msg) }
        }
    }

    private fun ask(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        showReply(t, "…")
        thread {
            val r = try { Api(this).assistant(t).optString("reply", "Done.") } catch (e: Exception) { e.message ?: "Could not reach Stashr." }
            main.post { showReply(t, r) }
        }
    }

    private fun showReply(heard: String, text: String) {
        reply.visibility = View.VISIBLE
        reply.text = if (heard.isNotEmpty()) "“$heard”\n$text" else text
    }

    /** One spoken command from the mic button. The "Hey Stashr" listener pauses meanwhile, since the mic is shared. */
    private fun listenOnce() {
        if (!granted(Manifest.permission.RECORD_AUDIO)) { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_PERMS); return }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { showReply("", "Speech recognition is not available on this tablet. Install the Google app."); return }
        VoiceListener.stop()
        oneShot?.destroy()
        val rec = SpeechRecognizer.createSpeechRecognizer(this)
        oneShot = rec
        micButton.text = "● Listening"
        rec.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onError(error: Int) { done(); showReply("", "Did not catch that. Tap the mic and try again.") }
            override fun onResults(results: Bundle?) {
                done()
                val said = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (said.isNotBlank()) ask(VoiceListener.afterWake(said)?.ifEmpty { null } ?: said)
            }
        })
        rec.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
            putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", arrayOf("en-IN"))
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        })
    }

    private fun done() {
        micButton.text = "🎤 Speak"
        oneShot?.destroy(); oneShot = null
        if (prefs.voiceOn) main.postDelayed({ VoiceListener.start(this) }, 800)
    }

    private fun unpair() {
        AlertDialog.Builder(this)
            .setTitle("Unpair this tablet?")
            .setMessage("It stops reporting to Stashr. To bring it back, make a new code on the Smart home page.")
            .setPositiveButton("Unpair") { _, _ ->
                prefs.forget()
                stopService(Intent(this, HubService::class.java))
                startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ───────── permissions ───────── */

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun askPermissions() {
        val want = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = want.filter { !granted(it) }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQ_PERMS) else askBattery()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PERMS) return
        // The service's foreground types (camera, microphone) are fixed when it starts: restart it with the new grants.
        stopService(Intent(this, HubService::class.java))
        main.postDelayed({ HubService.start(this) }, 500)
        askBattery()
    }

    @SuppressLint("BatteryLife")
    private fun askBattery() {
        val pm = getSystemService(PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) { askOverlay(); return }
        val p = getSharedPreferences("dashboard", MODE_PRIVATE)
        if (p.getBoolean("askedBattery", false)) return
        p.edit().putBoolean("askedBattery", true).apply()
        try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
    }

    /** Lets the app open its screens (today's updates, the slideshow) when Stashr asks, while another app is showing. */
    private fun askOverlay() {
        if (Settings.canDrawOverlays(this)) return
        val p = getSharedPreferences("dashboard", MODE_PRIVATE)
        if (p.getBoolean("askedOverlay", false)) return
        p.edit().putBoolean("askedOverlay", true).apply()
        try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
    }

    /* ───────── lifecycle ───────── */

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean { lastTouch = System.currentTimeMillis(); return super.dispatchTouchEvent(ev) }
    override fun onResume() { super.onResume(); resumed = true; lastTouch = System.currentTimeMillis() }
    override fun onPause() { resumed = false; super.onPause() }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        scope.cancel()
        oneShot?.destroy()
        try { unregisterReceiver(voiceReceiver) } catch (e: Exception) { }
        super.onDestroy()
    }

    private fun agoText(ms: Long): String {
        val s = (System.currentTimeMillis() - ms) / 1000
        return when { s < 45 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86400 -> "${s / 3600} h ago"; else -> "${s / 86400} d ago" }
    }

    companion object { private const val REQ_PERMS = 7 }
}

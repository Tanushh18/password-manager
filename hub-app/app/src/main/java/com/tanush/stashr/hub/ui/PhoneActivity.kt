package com.tanush.stashr.hub.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.hub.core.DeviceInfo
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.core.Ui
import com.tanush.stashr.hub.phone.PhoneReporter
import com.tanush.stashr.hub.update.Updater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** The family phone screen: what it shares with Stashr, when it last sent, and a way to stop. */
class PhoneActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var values: TextView
    private lateinit var sent: TextView
    private lateinit var result: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this)
        val prefs = Prefs(this)
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Hub · family phone"))
        col.addView(ui.h1(prefs.deviceName.ifBlank { "This phone" }))
        col.addView(ui.dim("This phone tells your Stashr home how it is doing, about every 15 minutes and when it joins the Wi-Fi."))

        val card = ui.card("What is shared", "Live values from this phone")
        values = ui.body("")
        card.addView(values)
        sent = ui.dim("")
        card.addView(sent)
        result = ui.text("", 13f, ui.c.muted)
        card.addView(result)
        val buttons = ui.row()
        buttons.addView(ui.primary("Send now") {
            result.text = "Sending…"
            scope.launch { result.text = PhoneReporter.reportNow(this@PhoneActivity); refresh() }
        })
        buttons.addView(ui.quiet("Check for update") {
            result.text = "Checking…"
            scope.launch { result.text = Updater.check(this@PhoneActivity, true) }
        })
        card.addView(buttons)
        col.addView(card)

        val privacy = ui.card("Private by design")
        privacy.addView(ui.body("Stashr only gets battery, storage, memory, the network type and this phone's address on the home Wi-Fi. It cannot read your messages, photos, calls or location."))
        col.addView(privacy)

        col.addView(ui.danger("Unpair this phone") {
            AlertDialog.Builder(this).setTitle("Unpair this phone?")
                .setMessage("It stops sending its health to Stashr. Make a new code on the Smart home page to pair it again.")
                .setPositiveButton("Unpair") { _, _ ->
                    PhoneReporter.cancel(this); prefs.forget()
                    startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)); finish()
                }.setNegativeButton("Cancel", null).show()
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        PhoneReporter.schedule(this)
    }

    override fun onResume() { super.onResume(); tick() }
    override fun onPause() { handler.removeCallbacksAndMessages(null); super.onPause() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun tick() { refresh(); handler.postDelayed({ tick() }, 10_000) }

    private fun refresh() {
        val b = DeviceInfo.battery(this)
        val s = DeviceInfo.storage(); val r = DeviceInfo.ram(this)
        val used = { j: org.json.JSONObject -> val t = j.optLong("total"); if (t > 0) Math.round(100.0 * (1 - j.optLong("free").toDouble() / t)) else 0 }
        val gb = { v: Long -> String.format("%.1f GB", v / 1e9) }
        values.text = buildString {
            append("🔋 Battery: ${b.opt("pct")}%${if (b.optBoolean("charging")) " (charging)" else ""}${b.optString("health").let { if (it.isNotBlank()) " · health $it" else "" }}\n")
            append("💾 Storage: ${used(s)}% full · ${gb(s.optLong("free"))} free\n")
            append("🧠 Memory: ${used(r)}% used\n")
            append("📶 Network: ${DeviceInfo.networkName(this@PhoneActivity)}${if (DeviceInfo.onWifi(this@PhoneActivity)) " · " + DeviceInfo.localIp() else ""}")
        }
        sent.text = if (PhoneReporter.lastSentAt > 0) "Last sent: " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(PhoneReporter.lastSentAt)) else "Last sent: not yet from this screen"
    }
}

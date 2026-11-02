package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.LinearLayout
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.core.Ui
import kotlin.concurrent.thread

/**
 * Pairing, the only setup: on the Smart home page make a code ("Add a tablet or a family phone"), type it here.
 * The code says whether this is the home tablet or a family phone. No Stashr password is typed on this device.
 */
class SetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = Ui(this)
        val prefs = Prefs(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Hub"))
        col.addView(ui.h1("Join your Stashr home"))
        col.addView(ui.dim("On stashr, open Smart home → “Add a tablet or a family phone”, choose what this device is, and tap “Make a code”. Then type the code here."))

        val card = ui.card("Pairing code", "8 letters, works once for 15 minutes")
        val code = ui.input("ABCD-2345", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        code.textSize = 22f; code.letterSpacing = 0.12f
        card.addView(code)
        val error = ui.text("", 13f, ui.c.danger).apply { visibility = View.GONE }
        card.addView(error)

        val advanced = ui.column(8).apply { visibility = View.GONE }
        val server = ui.input("Server address", prefs.server, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val server2 = ui.input("Backup server address", prefs.server2, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        advanced.addView(ui.dim("Stashr has two servers. The app uses the second one when the first is asleep or down. Only change these if your Stashr runs elsewhere."))
        advanced.addView(server)
        advanced.addView(server2)

        val go = ui.primary("Join") {}
        go.setOnClickListener {
            val typed = code.text.toString().trim()
            if (typed.replace("-", "").length != 8) { error.text = "Type all 8 letters of the code."; error.visibility = View.VISIBLE; return@setOnClickListener }
            go.isEnabled = false; go.text = "Joining…"; error.visibility = View.GONE
            prefs.server = server.text.toString().ifBlank { prefs.server }
            prefs.server2 = server2.text.toString().ifBlank { prefs.server2 }
            thread {
                try {
                    val r = Api(this).pair(typed, android.os.Build.MODEL)
                    val device = r.getJSONObject("device")
                    prefs.token = r.getString("token")
                    prefs.role = device.optString("kind", "hub")
                    prefs.deviceName = device.optString("name")
                    runOnUiThread { startActivity(Intent(this, MainActivity::class.java)); finish() }
                } catch (e: Exception) {
                    runOnUiThread { error.text = e.message ?: "Could not join."; error.visibility = View.VISIBLE; go.isEnabled = true; go.text = "Join" }
                }
            }
        }
        card.addView(go, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(card)

        val what = ui.card("One app, two jobs")
        what.addView(ui.body("🏠  On the always-on home tablet: it watches the Wi-Fi and finds device names, tests the internet, runs the camera, listens for “Hey Stashr”, shows a home dashboard and a photo slideshow."))
        what.addView(ui.body("📱  On a family phone: it sends battery, storage and memory to Stashr, and tells Stashr when the phone is home on the Wi-Fi."))
        col.addView(what)
        col.addView(ui.quiet("Server address…") { advanced.visibility = if (advanced.visibility == View.GONE) View.VISIBLE else View.GONE })
        col.addView(advanced)
        setContentView(root)
    }
}

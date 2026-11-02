package com.tanush.stashr.tv.ui

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.tv.cast.CastHub
import com.tanush.stashr.tv.cast.Tokens
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.core.Ui
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** "Screen mirror": the PIN to type on the phone, and the phones that are remembered. */
class MirrorActivity : Activity() {
    private lateinit var ui: Ui
    private lateinit var prefs: Prefs
    private lateinit var pinView: TextView
    private lateinit var status: TextView
    private lateinit var phones: LinearLayout
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var alive = false
    private var shownTokens = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this); prefs = Prefs(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr TV"))
        col.addView(ui.h1("Screen mirror"))
        val card = ui.card(prefs.deviceName.ifBlank { "This TV" }, "On your phone open Stashr Cast, pick this TV and type the PIN")
        pinView = TextView(this).apply { textSize = 96f; setTextColor(ui.text); typeface = android.graphics.Typeface.create(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD); letterSpacing = 0.25f; gravity = Gravity.CENTER; setPadding(0, ui.dp(12), 0, ui.dp(12)) }
        card.addView(pinView)
        status = ui.dim("")
        card.addView(status)
        col.addView(card)
        val known = ui.card("Phones that can mirror without the PIN")
        phones = ui.column(12)
        known.addView(phones)
        known.addView(ui.danger("Forget all phones") { prefs.castTokens = ""; refresh(true) })
        col.addView(known)
        col.addView(ui.quiet("Back") { finish() })
        setContentView(root)
    }

    override fun onResume() { super.onResume(); alive = true; refresh(true) }
    override fun onPause() { alive = false; main.removeCallbacksAndMessages(null); super.onPause() }

    private fun refresh(force: Boolean = false) {
        pinView.text = prefs.castPin()
        status.text = when {
            CastHub.active() -> "Showing ${CastHub.from()} now."
            CastHub.port == 0 -> "Screen mirror is not running yet. Open Stashr TV once while linked."
            else -> "Ready (port ${CastHub.port}). Keep the phone and the TV on the same Wi-Fi; 5 GHz is smoother."
        }
        val tokens = Tokens.parse(prefs.castTokens)
        val sig = tokens.joinToString("|") { it.token }
        if (force || sig != shownTokens) {
            shownTokens = sig
            phones.removeAllViews()
            if (tokens.isEmpty()) phones.addView(ui.dim("None yet. The first time a phone casts, it shows up here."))
            val fmt = SimpleDateFormat("d MMM HH:mm", Locale.getDefault())
            for (t in tokens) {
                val row = ui.row(16)
                row.addView(ui.fill(ui.body("${t.name} · added ${fmt.format(Date(t.at))}")))
                row.addView(ui.quiet("Forget") { prefs.castTokens = Tokens.toJson(Tokens.forget(Tokens.parse(prefs.castTokens), t.token)); refresh(true) })
                phones.addView(row)
            }
        }
        if (alive) main.postDelayed({ refresh() }, 2000)
    }
}

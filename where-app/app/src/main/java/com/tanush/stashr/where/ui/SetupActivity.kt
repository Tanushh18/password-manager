package com.tanush.stashr.where.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import com.tanush.stashr.where.core.Api
import com.tanush.stashr.where.core.Logic
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.Ui
import com.tanush.stashr.where.work.Scheduler
import kotlin.concurrent.thread

/** Link this phone: the code from the Stashr website, and the name the family will see. */
class SetupActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = Ui(this)
        val prefs = Prefs(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr Location"))
        col.addView(ui.h1("Link this phone"))
        col.addView(ui.dim("Shares only where you are with your family's Stashr. Nothing else from this phone."))
        if (prefs.message.isNotEmpty()) {
            col.addView(ui.card().apply { addView(ui.body(prefs.message)) })
            prefs.message = ""
        }

        val card = ui.card("Connect", "Open Stashr on the web → Smart home → Devices → Link a phone, and type the code shown there.")
        val code = ui.input("Link code (8 letters)", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        code.filters = arrayOf(InputFilter.AllCaps(), InputFilter.LengthFilter(12))
        val name = ui.input("Your name, e.g. Parveen Chawla", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        name.imeOptions = EditorInfo.IME_ACTION_DONE
        val server = ui.input("Server address", prefs.server, InputType.TYPE_TEXT_VARIATION_URI)
        val server2 = ui.input("Backup server address", prefs.server2, InputType.TYPE_TEXT_VARIATION_URI)
        val advanced = ui.column(8).apply { visibility = View.GONE; addView(ui.dim("Stashr has two servers. The app uses the second one when the first is asleep or down. Only change these if your family runs Stashr somewhere else.")); addView(server); addView(server2) }
        val toggle = ui.dim("Advanced ▸").apply { setPadding(0, ui.dp(4), 0, ui.dp(4)); setOnClickListener { advanced.visibility = if (advanced.visibility == View.GONE) View.VISIBLE else View.GONE } }
        val error: TextView = ui.text("", 13f, ui.c.danger)
        val connect = ui.primary("Connect") {}
        card.addView(code); card.addView(name); card.addView(toggle); card.addView(advanced); card.addView(error); card.addView(connect)
        col.addView(card)

        connect.setOnClickListener {
            val c = Logic.cleanCode(code.text.toString()); val n = name.text.toString().trim()
            if (c.length != 8) { error.text = "The code has 8 letters."; return@setOnClickListener }
            if (n.length < 2) { error.text = "Type your name."; return@setOnClickListener }
            val s = server.text.toString().trim()
            if (!s.startsWith("https://")) { error.text = "The server address must start with https://"; return@setOnClickListener }
            error.text = ""; connect.isEnabled = false; connect.text = "Connecting…"
            prefs.server = s
            val s2 = server2.text.toString().trim()
            if (s2.isNotEmpty() && !s2.startsWith("https://")) { error.text = "The backup address must start with https://"; connect.isEnabled = true; connect.text = "Connect"; return@setOnClickListener }
            if (s2.isNotEmpty()) prefs.server2 = s2
            thread {
                try {
                    val r = Api(this).link(c, n)
                    val token = r.optString("token")
                    if (token.isEmpty()) throw IllegalStateException("The server did not send a token.")
                    prefs.token = token
                    prefs.name = r.optString("name").ifBlank { n }
                    Scheduler.start(this)
                    main.post { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish() }
                } catch (e: Exception) {
                    main.post { error.text = e.message ?: "Could not connect."; connect.isEnabled = true; connect.text = "Connect" }
                }
            }
        }
        setContentView(root)
    }
}

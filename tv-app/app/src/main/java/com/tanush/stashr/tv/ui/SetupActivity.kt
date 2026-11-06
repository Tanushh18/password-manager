package com.tanush.stashr.tv.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.LinearLayout
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.core.Ui
import com.tanush.stashr.tv.service.TvService
import kotlin.concurrent.thread

/** First run: the home-device code from the Stashr website and a name for this TV. */
class SetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val ui = Ui(this); val prefs = Prefs(this)
        val (root, col) = ui.page()
        col.addView(ui.eyebrow("Stashr TV"))
        col.addView(ui.h1("Link this TV to your Stashr home"))
        col.addView(ui.dim("On Stashr open Smart home → Devices → “Link the home tablet or TV”. Type the 8-letter code shown there and give this TV a name."))

        val card = ui.card("Home-device code", "The same code every time, until you make a new one on the website")
        val code = ui.input("ABCD2345", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        code.filters = arrayOf(InputFilter.AllCaps(), InputFilter.LengthFilter(12)); code.letterSpacing = 0.12f
        val name = ui.input("TV name", prefs.deviceName.ifEmpty { "Living room TV" }, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS)
        name.imeOptions = EditorInfo.IME_ACTION_DONE
        val error = ui.text("", 18f, ui.danger).apply { visibility = View.GONE }
        val advanced = ui.column(12).apply { visibility = View.GONE }
        val s1 = ui.input("Server address", prefs.server, InputType.TYPE_TEXT_VARIATION_URI)
        val s2 = ui.input("Backup server address", prefs.server2, InputType.TYPE_TEXT_VARIATION_URI)
        advanced.addView(ui.dim("Stashr has two servers. The TV uses the second one when the first is asleep or down."))
        advanced.addView(s1); advanced.addView(s2)
        val go = ui.primary("Link this TV") {}
        go.setOnClickListener {
            val typed = code.text.toString().uppercase().filter { it.isLetterOrDigit() }
            val nm = name.text.toString().trim()
            if (typed.length != 8) { error.text = "Type all 8 letters of the code."; error.visibility = View.VISIBLE; return@setOnClickListener }
            if (nm.length < 2) { error.text = "Give this TV a name."; error.visibility = View.VISIBLE; return@setOnClickListener }
            val a = s1.text.toString().trim(); val b = s2.text.toString().trim()
            if (!a.startsWith("https://") || (b.isNotEmpty() && !b.startsWith("https://"))) { error.text = "Server addresses start with https://"; error.visibility = View.VISIBLE; return@setOnClickListener }
            prefs.server = a; if (b.isNotEmpty()) prefs.server2 = b
            go.isEnabled = false; go.text = "Linking…"; error.visibility = View.GONE
            thread {
                try {
                    val r = Api(this).link(typed, nm)
                    prefs.token = r.getString("token"); prefs.deviceName = nm
                    runOnUiThread { TvService.start(this); startActivity(Intent(this, HomeActivity::class.java)); finish() }
                } catch (e: Exception) {
                    runOnUiThread { error.text = e.message ?: "Could not link."; error.visibility = View.VISIBLE; go.isEnabled = true; go.text = "Link this TV" }
                }
            }
        }
        card.addView(code); card.addView(name); card.addView(error); card.addView(go, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(card)
        col.addView(ui.quiet("Server addresses…") { advanced.visibility = if (advanced.visibility == View.GONE) View.VISIBLE else View.GONE })
        col.addView(advanced)
        setContentView(root)
        code.requestFocus()
    }
}

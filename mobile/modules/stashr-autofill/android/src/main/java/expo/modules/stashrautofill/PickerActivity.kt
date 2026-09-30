package expo.modules.stashrautofill

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Search screen over the app in front: the overlay can't take keyboard input, an activity can. */
class PickerActivity : Activity() {
  private lateinit var all: List<Credential>
  private var preferred: Set<String> = emptySet()
  private lateinit var rows: LinearLayout

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    all = CredentialStore.load(this)
    preferred = intent.getStringArrayExtra(EXTRA_PREFERRED)?.toSet().orEmpty()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(40), dp(12), dp(12))
      setOnClickListener { finish() }
    }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(0xFF1B0D0D.toInt())
        cornerRadius = dp(16).toFloat()
        setStroke(dp(1), 0xFF3A2222.toInt())
      }
      setPadding(dp(8), dp(8), dp(8), dp(8))
      isClickable = true
    }
    val search = EditText(this).apply {
      hint = "Search name, username or website"
      setHintTextColor(0xFF8F7373.toInt())
      setTextColor(0xFFFFFFFF.toInt())
      textSize = 15f
      setSingleLine(true)
      setPadding(dp(12), dp(12), dp(12), dp(12))
      addTextChangedListener(object : TextWatcher {
        override fun afterTextChanged(s: Editable?) = render(s?.toString().orEmpty())
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      })
    }
    card.addView(search)
    rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    card.addView(
      ScrollView(this).apply { addView(rows) },
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
    )
    root.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    setContentView(root)
    render("")
    search.requestFocus()
  }

  private fun render(query: String) {
    val q = query.trim().lowercase()
    val hits = all
      .filter { q.isEmpty() || it.name.lowercase().contains(q) || it.username.lowercase().contains(q) || it.url.lowercase().contains(q) }
      .sortedWith(compareByDescending<Credential> { it.id in preferred }.thenBy { it.name.lowercase() })
      .take(60)
    rows.removeAllViews()
    if (hits.isEmpty()) {
      rows.addView(TextView(this).apply {
        text = if (all.isEmpty()) "Open Stashr and sign in to load your logins" else "No logins match"
        setTextColor(0xFFB89A9A.toInt())
        setPadding(dp(12), dp(16), dp(12), dp(16))
      })
      return
    }
    hits.forEach { c ->
      rows.addView(TextView(this).apply {
        text = if (c.username.isNotBlank()) "${c.name.ifBlank { "Untitled" }}\n${c.username}" else c.name.ifBlank { "Untitled" }
        setTextColor(0xFFFFFFFF.toInt())
        textSize = 14f
        typeface = if (c.id in preferred) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        minHeight = dp(52)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), dp(6), dp(12), dp(6))
        setOnClickListener { pick(c.id) }
      })
    }
  }

  private fun pick(id: String) {
    val cb = pending
    pending = null
    cb?.invoke(id)
    finish()
  }

  override fun onDestroy() {
    pending = null
    super.onDestroy()
  }

  companion object {
    private const val EXTRA_PREFERRED = "preferred"
    private var pending: ((String) -> Unit)? = null

    fun request(ctx: Context, preferredIds: Set<String>, onPick: (String) -> Unit) {
      pending = onPick
      ctx.startActivity(
        Intent(ctx, PickerActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          .putExtra(EXTRA_PREFERRED, preferredIds.toTypedArray())
      )
    }
  }
}

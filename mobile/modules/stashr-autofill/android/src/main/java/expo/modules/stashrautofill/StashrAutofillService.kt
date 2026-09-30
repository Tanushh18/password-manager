package expo.modules.stashrautofill

import android.accessibilityservice.AccessibilityService
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class StashrAutofillService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var overlay: View? = null
  private var overlayPackage: String? = null
  private val autoHide = Runnable { hideOverlay() }

  private val browserUrlIds = listOf(
    "com.android.chrome:id/url_bar",
    "com.brave.browser:id/url_bar",
    "com.microsoft.emmx:id/url_bar",
    "com.sec.android.app.sbrowser:id/location_bar_edit_text",
    "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
    "org.mozilla.fenix:id/mozac_browser_toolbar_url_view",
    "com.opera.browser:id/url_field",
    "com.heytap.browser:id/url_bar",
    "com.coloros.browser:id/url_bar",
    "com.duckduckgo.mobile.android:id/omnibarTextInput",
  )

  override fun onServiceConnected() {
    instance = this
  }

  override fun onDestroy() {
    hideOverlay()
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onInterrupt() = hideOverlay()

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    event ?: return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == packageName) return
    if (pkg == "com.android.systemui") return

    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && overlayPackage != null && overlayPackage != pkg) {
      hideOverlay()
      return
    }
    if (event.eventType != AccessibilityEvent.TYPE_VIEW_FOCUSED) return

    val source = event.source ?: return
    try {
      if (!source.isEditable) {
        hideOverlay()
        return
      }
      if (isLoginField(source)) showFor(pkg, source) else hideOverlay()
    } finally {
      @Suppress("DEPRECATION") source.recycle()
    }
  }

  private fun passwordNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
    val out = mutableListOf<AccessibilityNodeInfo>()
    fun walk(n: AccessibilityNodeInfo?) {
      n ?: return
      if (n.isPassword && n.isVisibleToUser) out += n
      for (i in 0 until n.childCount) walk(n.getChild(i))
    }
    walk(root)
    return out
  }

  private fun editableNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
    val out = mutableListOf<AccessibilityNodeInfo>()
    fun walk(n: AccessibilityNodeInfo?) {
      n ?: return
      if (n.isEditable && n.isVisibleToUser) out += n
      for (i in 0 until n.childCount) walk(n.getChild(i))
    }
    walk(root)
    return out
  }

  /** A password field, or the field right before one on the same screen (the username box). */
  private fun isLoginField(node: AccessibilityNodeInfo): Boolean {
    if (node.isPassword) return true
    val root = rootInActiveWindow ?: return false
    val fields = editableNodes(root)
    val idx = fields.indexOfFirst { it == node }
    return idx >= 0 && idx + 1 < fields.size && fields[idx + 1].isPassword
  }

  private fun browserUrl(root: AccessibilityNodeInfo, pkg: String): String? {
    val ids = browserUrlIds.filter { it.startsWith("$pkg:") }.ifEmpty { browserUrlIds }
    for (id in ids) {
      val hit = root.findAccessibilityNodeInfosByViewId(id).firstOrNull()?.text?.toString()
      if (!hit.isNullOrBlank()) return hit
    }
    return null
  }

  private fun appLabel(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (e: Exception) {
    ""
  }

  private fun showFor(pkg: String, anchor: AccessibilityNodeInfo) {
    val all = CredentialStore.load(this)
    val root = rootInActiveWindow ?: return
    val url = if (Matcher.isBrowser(pkg)) browserUrl(root, pkg) else null
    val matches = Matcher.match(all, pkg, appLabel(pkg), url)
    val bounds = Rect().also { anchor.getBoundsInScreen(it) }
    val header = when {
      all.isEmpty() -> "Open Stashr and sign in to load your logins"
      matches.isNotEmpty() -> "Stashr · ${matches.size} for this ${if (url != null) "site" else "app"}"
      else -> "Stashr · nothing saved for this ${if (url != null) "site" else "app"}"
    }
    showOverlay(pkg, header, if (matches.isNotEmpty()) matches else all, showAllButton = matches.isNotEmpty() && matches.size < all.size, all = all, bounds = bounds)
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private fun showOverlay(
    pkg: String,
    header: String,
    list: List<Credential>,
    showAllButton: Boolean,
    all: List<Credential>,
    bounds: Rect,
  ) {
    hideOverlay()
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(0xFF1B0D0D.toInt())
        cornerRadius = dp(16).toFloat()
        setStroke(dp(1), 0xFF3A2222.toInt())
      }
      setPadding(dp(4), dp(4), dp(4), dp(4))
    }

    val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    top.addView(
      TextView(this).apply {
        text = header
        setTextColor(0xFFE8D8D8.toInt())
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(12), dp(10), dp(12), dp(10))
      },
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    top.addView(TextView(this).apply {
      text = "✕"
      setTextColor(0xFFB89A9A.toInt())
      textSize = 16f
      setPadding(dp(14), dp(8), dp(14), dp(8))
      setOnClickListener { hideOverlay() }
    })
    card.addView(top)

    val listBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    fun rows(items: List<Credential>) {
      listBox.removeAllViews()
      items.forEach { c ->
        listBox.addView(TextView(this).apply {
          text = if (c.username.isNotBlank()) "${c.name.ifBlank { "Untitled" }}\n${c.username}" else c.name.ifBlank { "Untitled" }
          setTextColor(0xFFFFFFFF.toInt())
          textSize = 14f
          minHeight = dp(52)
          gravity = Gravity.CENTER_VERTICAL
          setPadding(dp(12), dp(6), dp(12), dp(6))
          setOnClickListener { confirmAndFill(c) }
        })
      }
      if (items.isEmpty()) {
        listBox.addView(TextView(this).apply {
          text = "No saved logins yet"
          setTextColor(0xFFB89A9A.toInt())
          setPadding(dp(12), dp(6), dp(12), dp(12))
        })
      }
    }
    rows(list)

    val rowCount = list.size.coerceAtLeast(1)
    val listHeight = (rowCount * 52).coerceAtMost(208)
    card.addView(
      ScrollView(this).apply { addView(listBox) },
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(listHeight))
    )

    if (showAllButton) {
      card.addView(TextView(this).apply {
        text = "Show all logins"
        setTextColor(0xFF31AAA9.toInt())
        textSize = 13f
        setPadding(dp(12), dp(8), dp(12), dp(10))
        setOnClickListener {
          rows(all)
          visibility = View.GONE
        }
      })
    }

    val totalHeight = dp(46 + listHeight + (if (showAllButton) 36 else 0) + 8)
    val screenH = resources.displayMetrics.heightPixels
    val y = (bounds.top - totalHeight - dp(8)).let { if (it < dp(24)) (bounds.bottom + dp(8)).coerceAtMost(screenH - totalHeight) else it }

    val lp = WindowManager.LayoutParams(
      resources.displayMetrics.widthPixels - dp(24),
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_SECURE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      this.y = y
    }
    (getSystemService(WINDOW_SERVICE) as WindowManager).addView(card, lp)
    overlay = card
    overlayPackage = pkg
    main.removeCallbacks(autoHide)
    main.postDelayed(autoHide, 60_000)
  }

  private fun hideOverlay() {
    main.removeCallbacks(autoHide)
    overlay?.let { v ->
      try {
        (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(v)
      } catch (e: Exception) {
      }
    }
    overlay = null
    overlayPackage = null
  }

  private fun confirmAndFill(c: Credential) {
    hideOverlay()
    if (CredentialStore.requireBiometric(this) && AuthActivity.canPrompt(this)) {
      AuthActivity.request(this) { ok -> if (ok) main.postDelayed({ fill(c) }, 300) }
    } else {
      fill(c)
    }
  }

  private fun setText(node: AccessibilityNodeInfo, value: String) {
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
    node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
  }

  private fun fill(c: Credential) {
    val root = rootInActiveWindow ?: return
    val password = passwordNodes(root).firstOrNull() ?: return
    val fields = editableNodes(root)
    val idx = fields.indexOfFirst { it == password }
    val userField = if (idx > 0 && !fields[idx - 1].isPassword) fields[idx - 1] else null
    if (userField != null && c.username.isNotEmpty()) setText(userField, c.username)
    setText(password, c.password)
  }

  companion object {
    @Volatile var instance: StashrAutofillService? = null
  }
}

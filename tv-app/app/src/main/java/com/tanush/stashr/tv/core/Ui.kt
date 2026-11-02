package com.tanush.stashr.tv.core

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The Stashr dark look (the website's dark tokens), made for a TV: big text, strong focus rings, everything reachable with a D-pad. */
class Ui(val ctx: Context) {
    val bg = Color.parseColor("#08121A")
    val surface = Color.parseColor("#0E1B1F")
    val sunken = Color.parseColor("#0B161A")
    val text = Color.parseColor("#D9E5E1")
    val muted = Color.parseColor("#9BB0AB")
    val faint = Color.parseColor("#758C87")
    val line = Color.parseColor("#1D3134")
    val lineStrong = Color.parseColor("#2A4447")
    val primary = Color.parseColor("#0E7F6D")
    val accent = Color.parseColor("#2BB3B1")
    val ok = Color.parseColor("#30A46C")
    val warn = Color.parseColor("#D4A72C")
    val danger = Color.parseColor("#E5484D")

    fun dp(v: Number) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    fun rounded(fill: Int, stroke: Int? = null, radius: Number = 12, strokeDp: Number = 1) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke != null) setStroke(dp(strokeDp), stroke)
    }

    /** Normal: a quiet card. Focused: the accent ring, so the D-pad position is always obvious. */
    fun focusable(fill: Int = surface, radius: Number = 12): StateListDrawable = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), rounded(sunken, accent, radius, 4))
        addState(intArrayOf(android.R.attr.state_pressed), rounded(sunken, accent, radius, 4))
        addState(intArrayOf(), rounded(fill, line, radius, 1))
    }

    /** Frosted-glass card for the launcher: see-through white on the colour wash, a bright ring when focused. */
    fun glass(radius: Number = 16): StateListDrawable = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), rounded(Color.argb(70, 255, 255, 255), Color.WHITE, radius, 4))
        addState(intArrayOf(android.R.attr.state_pressed), rounded(Color.argb(70, 255, 255, 255), Color.WHITE, radius, 4))
        addState(intArrayOf(), rounded(Color.argb(38, 255, 255, 255), Color.argb(60, 255, 255, 255), radius, 1))
    }

    fun page(): Pair<ScrollView, LinearLayout> {
        val col = column().apply { setPadding(dp(48), dp(32), dp(48), dp(40)) }
        val scroll = ScrollView(ctx).apply { setBackgroundColor(bg); isFillViewport = true; addView(col) }
        return scroll to col
    }

    fun column(gap: Int = 16) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        dividerDrawable = GradientDrawable().apply { setSize(0, dp(gap)) }
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }

    fun row(gap: Int = 16) = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        dividerDrawable = GradientDrawable().apply { setSize(dp(gap), 0) }
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }

    fun card(title: String? = null, subtitle: String? = null): LinearLayout = column(12).apply {
        background = rounded(surface, line)
        setPadding(dp(24), dp(20), dp(24), dp(24))
        if (title != null) addView(text(title, 22f, this@Ui.text, bold = true))
        if (subtitle != null) addView(dim(subtitle))
    }

    fun h1(s: String) = text(s, 36f, text, bold = true)
    fun h2(s: String) = text(s, 24f, text, bold = true)
    fun eyebrow(s: String) = text(s.uppercase(), 14f, faint, bold = true).apply { letterSpacing = 0.06f }
    fun dim(s: String) = text(s, 18f, muted)
    fun body(s: String) = text(s, 20f, text)

    fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(ctx).apply {
        text = s; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setLineSpacing(0f, 1.15f)
    }

    fun primary(label: String, onClick: () -> Unit) = button(label, primary, Color.WHITE, onClick)
    fun quiet(label: String, onClick: () -> Unit) = button(label, surface, text, onClick)
    fun danger(label: String, onClick: () -> Unit) = button(label, surface, danger, onClick)

    private fun button(label: String, fill: Int, fg: Int, onClick: () -> Unit) = Button(ctx).apply {
        text = label; isAllCaps = false; setTextColor(fg); setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        background = focusable(fill, 12); stateListAnimator = null; isFocusable = true
        minHeight = dp(64); minimumHeight = dp(64); setPadding(dp(28), 0, dp(28), 0)
        setOnClickListener { onClick() }
    }

    fun input(hint: String, value: String = "", type: Int = InputType.TYPE_CLASS_TEXT) = EditText(ctx).apply {
        this.hint = hint; setText(value); inputType = type; setTextColor(this@Ui.text); setHintTextColor(faint)
        background = focusable(surface, 12); setPadding(dp(20), dp(16), dp(20), dp(16)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        isSingleLine = true
    }

    fun withAlpha(color: Int, a: Float) = Color.argb((a * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    fun fill(v: View, weight: Float = 1f): View { v.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight); return v }
}

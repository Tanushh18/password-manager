package com.tanush.stashr.hub.core

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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

/**
 * The Stashr look, in code: the same colours as the website (client/src/styles/theme.css), white cards with a thin
 * border and 12dp corners on a soft green-grey page, the deep green primary button and quiet outlined buttons.
 * Dark mode follows the system and uses the website's dark tokens.
 */
class Palette(val dark: Boolean) {
    val bg = Color.parseColor(if (dark) "#08121A" else "#F5F7F2")
    val surface = Color.parseColor(if (dark) "#0E1B1F" else "#FFFFFF")
    val sunken = Color.parseColor(if (dark) "#0B161A" else "#F0F3EE")
    val text = Color.parseColor(if (dark) "#D9E5E1" else "#1C2B25")
    val muted = Color.parseColor(if (dark) "#9BB0AB" else "#4C5F57")
    val faint = Color.parseColor(if (dark) "#758C87" else "#66786F")
    val line = Color.parseColor(if (dark) "#1D3134" else "#DDE5DC")
    val lineStrong = Color.parseColor(if (dark) "#2A4447" else "#C6D2C6")
    val primary = Color.parseColor(if (dark) "#0E7F6D" else "#0D6E5C")
    val accent = Color.parseColor(if (dark) "#2BB3B1" else "#0F7F7D")
    val ok = Color.parseColor(if (dark) "#30A46C" else "#1D7F4E")
    val warn = Color.parseColor(if (dark) "#D4A72C" else "#9A6B00")
    val danger = Color.parseColor(if (dark) "#E5484D" else "#D1343A")

    companion object {
        fun of(ctx: Context) = Palette((ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES)
    }
}

/** Small builders so every screen looks the same. */
class Ui(val ctx: Context, dark: Boolean? = null) {
    val c = if (dark == null) Palette.of(ctx) else Palette(dark)
    fun dp(v: Number) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    fun rounded(fill: Int, stroke: Int? = null, radius: Number = 12) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke != null) setStroke(dp(1), stroke)
    }

    /** A scrolling page with the page background and side gutters; returns (root, column). */
    fun page(): Pair<ScrollView, LinearLayout> {
        val col = column().apply { setPadding(dp(16), dp(20), dp(16), dp(32)) }
        val scroll = ScrollView(ctx).apply { setBackgroundColor(c.bg); isFillViewport = true; addView(col) }
        return scroll to col
    }

    fun column(gap: Int = 12) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        dividerDrawable = GradientDrawable().apply { setSize(0, dp(gap)) }
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }

    fun row(gap: Int = 8) = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        dividerDrawable = GradientDrawable().apply { setSize(dp(gap), 0) }
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }

    /** A Stashr card: title, optional subtitle, then content. */
    fun card(title: String? = null, subtitle: String? = null): LinearLayout = column(10).apply {
        background = rounded(c.surface, c.line)
        setPadding(dp(16), dp(14), dp(16), dp(16))
        elevation = dp(1).toFloat()
        if (title != null) addView(text(title, 16f, c.text, bold = true))
        if (subtitle != null) addView(dim(subtitle))
    }

    fun h1(s: String) = text(s, 24f, c.text, bold = true)
    fun eyebrow(s: String) = text(s.uppercase(), 11f, c.faint, bold = true).apply { letterSpacing = 0.06f }
    fun dim(s: String) = text(s, 13f, c.faint)
    fun body(s: String) = text(s, 15f, c.text)

    fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(ctx).apply {
        text = s; setTextColor(color); setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setLineSpacing(0f, 1.15f)
    }

    fun primary(label: String, onClick: () -> Unit) = button(label, c.primary, null, Color.WHITE, onClick)
    fun quiet(label: String, onClick: () -> Unit) = button(label, c.surface, c.lineStrong, c.text, onClick)
    fun danger(label: String, onClick: () -> Unit) = button(label, c.surface, c.danger, c.danger, onClick)

    private fun button(label: String, fill: Int, stroke: Int?, fg: Int, onClick: () -> Unit) = Button(ctx).apply {
        text = label; isAllCaps = false; setTextColor(fg); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        background = rounded(fill, stroke, 10); stateListAnimator = null
        minHeight = dp(44); minimumHeight = dp(44); setPadding(dp(16), 0, dp(16), 0)
        setOnClickListener { onClick() }
    }

    fun input(hint: String, value: String = "", type: Int = InputType.TYPE_CLASS_TEXT) = EditText(ctx).apply {
        this.hint = hint; setText(value); inputType = type; setTextColor(c.text); setHintTextColor(c.faint)
        background = rounded(c.surface, c.lineStrong, 10); setPadding(dp(12), dp(10), dp(12), dp(10)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    }

    /** A rounded little label, like the website's chips. */
    fun chip(s: String, tint: Int? = null) = text(s, 12f, c.text).apply {
        background = rounded(if (tint != null) withAlpha(tint, 0.18f) else withAlpha(c.faint, 0.14f), null, 999)
        setPadding(dp(10), dp(3), dp(10), dp(3))
    }

    fun dot(color: Int) = View(ctx).apply { background = rounded(color, null, 999); layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)) }

    fun divider() = View(ctx).apply { setBackgroundColor(c.line); layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)) }

    fun withAlpha(color: Int, a: Float) = Color.argb((a * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    /* ───── glass look for the assistant hub: see-through white cards on the aurora background ───── */

    fun glass(radius: Number = 22, strong: Boolean = false) =
        rounded(Color.argb(if (strong) 52 else 30, 255, 255, 255), Color.argb(if (strong) 100 else 60, 255, 255, 255), radius)

    /** A glass card: optional icon + title, optional subtitle, then content added by the caller. */
    fun glassCard(title: String? = null, subtitle: String? = null, icon: String? = null): LinearLayout = column(12).apply {
        background = glass(22)
        setPadding(dp(20), dp(16), dp(20), dp(20))
        if (title != null) {
            val head = row(10)
            if (icon != null) head.addView(android.widget.ImageView(ctx).apply { setImageDrawable(com.tanush.stashr.hub.ui.LineIcon(icon, 0xCCFFFFFF.toInt())); layoutParams = LinearLayout.LayoutParams(dp(22), dp(22)) })
            head.addView(text(title, 17f, Color.WHITE, bold = true))
            addView(head)
        }
        if (subtitle != null) addView(text(subtitle, 13f, 0xB3FFFFFF.toInt()))
    }

    /** A round or pill button made of an icon and an optional label, glass-styled, with a clear focus/press state. */
    fun pill(label: String?, icon: String?, strong: Boolean = false, onClick: () -> Unit) = TextView(ctx).apply {
        text = label ?: ""; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER; isClickable = true; isFocusable = true; contentDescription = label ?: icon
        if (icon != null) { compoundDrawablePadding = if (label.isNullOrEmpty()) 0 else dp(8); setCompoundDrawablesRelative(com.tanush.stashr.hub.ui.LineIcon(icon).apply { setBounds(0, 0, dp(22), dp(22)) }, null, null, null) }
        val tint = if (strong) Color.argb(120, 14, 127, 109) else Color.argb(34, 255, 255, 255)
        background = android.graphics.drawable.StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), rounded(Color.argb(110, 255, 255, 255), Color.WHITE, 999))
            addState(intArrayOf(android.R.attr.state_focused), rounded(tint, Color.WHITE, 999))
            addState(intArrayOf(), rounded(tint, Color.argb(70, 255, 255, 255), 999))
        }
        setPadding(dp(if (label.isNullOrEmpty()) 14 else 18), dp(12), dp(if (label.isNullOrEmpty()) 14 else 20), dp(12))
        minHeight = dp(48)
        setOnClickListener { onClick() }
    }

    fun fill(v: View, weight: Float = 1f): View { v.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight); return v }
}

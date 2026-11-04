package com.tanush.stashr.hub.ui

import android.animation.ArgbEvaluator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.View

/**
 * The hub's background: the Stashr deep teal wash drifting slowly between navy, teal and plum, with a few soft glows.
 * The tablet is always on, so it is drawn only about once a second and not at all while the view is hidden.
 */
class AuroraView(ctx: Context) : View(ctx) {
    private val palette = intArrayOf(0xFF08121A.toInt(), 0xFF0A2A33.toInt(), 0xFF0B4A47.toInt(), 0xFF0C2F4A.toInt(), 0xFF111F3A.toInt())
    private val wash = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(palette[0], palette[1], palette[2]))
    private val eval = ArgbEvaluator()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var running = false
    private val frame = object : Runnable { override fun run() { if (running) { invalidate(); postDelayed(this, 1_000) } } }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); running = true; post(frame) }
    override fun onDetachedFromWindow() { running = false; super.onDetachedFromWindow() }
    override fun onVisibilityChanged(changed: View, visibility: Int) { super.onVisibilityChanged(changed, visibility); running = visibility == VISIBLE && isAttachedToWindow; if (running) { removeCallbacks(frame); post(frame) } }

    private fun at(x: Float): Int { val f = x % palette.size; val i = f.toInt(); return eval.evaluate(f - i, palette[i], palette[(i + 1) % palette.size]) as Int }

    override fun onDraw(c: Canvas) {
        val t = SystemClock.uptimeMillis().toFloat()
        val p = t / 60_000f
        wash.colors = intArrayOf(at(p), at(p + 1.7f), at(p + 3.4f))
        wash.setBounds(0, 0, width, height); wash.draw(c)
        val w = width.toFloat(); val h = height.toFloat(); val big = maxOf(w, h)
        glow(c, w * (0.20f + 0.12f * Math.sin(t / 23_000.0).toFloat()), h * (0.28f + 0.1f * Math.cos(t / 19_000.0).toFloat()), big * 0.36f, 0xFF2BB3B1.toInt(), 52)
        glow(c, w * (0.82f + 0.1f * Math.cos(t / 27_000.0).toFloat()), h * (0.22f + 0.1f * Math.sin(t / 21_000.0).toFloat()), big * 0.30f, 0xFF0E7F6D.toInt(), 56)
        glow(c, w * (0.55f + 0.1f * Math.sin(t / 31_000.0).toFloat()), h * (0.88f + 0.06f * Math.cos(t / 17_000.0).toFloat()), big * 0.38f, 0xFF3D7BFF.toInt(), 40)
        c.drawColor(Color.argb(70, 4, 10, 16))
    }

    private fun glow(c: Canvas, x: Float, y: Float, r: Float, color: Int, alpha: Int) {
        paint.shader = RadialGradient(x, y, r, Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color)), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        c.drawCircle(x, y, r, paint); paint.shader = null
    }
}

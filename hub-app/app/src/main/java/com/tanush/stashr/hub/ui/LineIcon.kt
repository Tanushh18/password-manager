package com.tanush.stashr.hub.ui

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/** Thin outline icons drawn from paths on a 24x24 grid: no image files, one quiet weight for the whole hub. */
class LineIcon(private val name: String, tint: Int = 0xF2FFFFFF.toInt()) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; strokeWidth = 1.7f; color = tint }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = tint }

    override fun draw(c: Canvas) {
        val s = bounds.width() / 24f
        c.save(); c.translate(bounds.left.toFloat(), bounds.top.toFloat()); c.scale(s, s)
        val p = Path()
        fun poly(vararg v: Float, close: Boolean = false) { p.reset(); p.moveTo(v[0], v[1]); var i = 2; while (i < v.size) { p.lineTo(v[i], v[i + 1]); i += 2 }; if (close) p.close(); c.drawPath(p, paint) }
        fun box(l: Float, t: Float, r: Float, b: Float, rad: Float) { p.reset(); p.addRoundRect(RectF(l, t, r, b), rad, rad, Path.Direction.CW); c.drawPath(p, paint) }
        fun arc(l: Float, t: Float, r: Float, b: Float, start: Float, sweep: Float) { p.reset(); p.addArc(RectF(l, t, r, b), start, sweep); c.drawPath(p, paint) }
        fun speaker() = poly(4f, 9f, 8f, 9f, 12f, 5f, 12f, 19f, 8f, 15f, 4f, 15f, close = true)
        when (name) {
            "home" -> { poly(3f, 11f, 12f, 3.5f, 21f, 11f); poly(5.5f, 9.5f, 5.5f, 20.5f, 18.5f, 20.5f, 18.5f, 9.5f); poly(10f, 20.5f, 10f, 14.5f, 14f, 14.5f, 14f, 20.5f) }
            "bell" -> {
                p.reset(); p.moveTo(6f, 16f); p.lineTo(6f, 11f); p.arcTo(RectF(6f, 5f, 18f, 17f), 180f, 180f); p.lineTo(18f, 16f); p.lineTo(19.5f, 18f); p.lineTo(4.5f, 18f); p.close(); c.drawPath(p, paint)
                arc(10f, 18.5f, 14f, 22.5f, 0f, 180f)
            }
            "sliders" -> { poly(4f, 7f, 12.5f, 7f); poly(17.5f, 7f, 20f, 7f); c.drawCircle(15f, 7f, 2.4f, paint); poly(4f, 17f, 5.5f, 17f); poly(10.5f, 17f, 20f, 17f); c.drawCircle(8f, 17f, 2.4f, paint) }
            "gear" -> {
                c.drawCircle(12f, 12f, 3f, paint); c.drawCircle(12f, 12f, 6.5f, paint)
                for (i in 0 until 8) { val a = Math.toRadians(i * 45.0); poly(12f + 8f * Math.cos(a).toFloat(), 12f + 8f * Math.sin(a).toFloat(), 12f + 10f * Math.cos(a).toFloat(), 12f + 10f * Math.sin(a).toFloat()) }
            }
            "mic" -> { box(9f, 3f, 15f, 13f, 3f); arc(6f, 6f, 18f, 18f, 0f, 180f); poly(12f, 18f, 12f, 21f); poly(9f, 21f, 15f, 21f) }
            "send" -> { poly(3f, 11.5f, 21f, 3f, 14f, 21f, 11.5f, 13.5f, close = true); poly(11.5f, 13.5f, 21f, 3f) }
            "tv" -> { box(3f, 5f, 21f, 16f, 2f); poly(8f, 20f, 16f, 20f) }
            "play" -> poly(8f, 5f, 19f, 12f, 8f, 19f, close = true)
            "pause" -> { poly(9f, 5f, 9f, 19f); poly(15f, 5f, 15f, 19f) }
            "next" -> { poly(6f, 6f, 14f, 12f, 6f, 18f, close = true); poly(17f, 6f, 17f, 18f) }
            "prev" -> { poly(18f, 6f, 10f, 12f, 18f, 18f, close = true); poly(7f, 6f, 7f, 18f) }
            "vol_up" -> { speaker(); arc(7.5f, 7.5f, 16.5f, 16.5f, -45f, 90f); arc(4f, 4f, 20f, 20f, -45f, 90f) }
            "vol_down" -> { speaker(); arc(7.5f, 7.5f, 16.5f, 16.5f, -45f, 90f) }
            "mute" -> { speaker(); poly(16f, 9f, 21f, 15f); poly(21f, 9f, 16f, 15f) }
            "back" -> { poly(11f, 5f, 4f, 12f, 11f, 19f); poly(4f, 12f, 20f, 12f) }
            "power" -> { arc(6f, 6f, 18f, 18f, -60f, 300f); poly(12f, 3f, 12f, 11f) }
            "camera" -> { box(3f, 7f, 21f, 19f, 2f); c.drawCircle(12f, 13f, 3.5f, paint); poly(9f, 7f, 10f, 5f, 14f, 5f, 15f, 7f) }
            "bolt" -> poly(13f, 3f, 6f, 13f, 11f, 13f, 10f, 21f, 18f, 10f, 13f, 10f, close = true)
            "users" -> { c.drawCircle(9f, 9f, 3f, paint); arc(3.5f, 14f, 14.5f, 25f, 180f, 180f); c.drawCircle(17f, 9.5f, 2.4f, paint); arc(13f, 14.5f, 22f, 23.5f, 200f, 140f) }
            "speed" -> { arc(3f, 5f, 21f, 23f, 180f, 180f); poly(12f, 14f, 16f, 9f); c.drawCircle(12f, 14f, 1.1f, fill) }
            "image" -> { box(3f, 5f, 21f, 19f, 2f); c.drawCircle(9f, 10f, 1.6f, paint); poly(4f, 18f, 10f, 13f, 14f, 17f, 17f, 14f, 20f, 17f) }
            "chat" -> { box(3f, 4f, 21f, 16f, 3f); poly(8f, 16f, 8f, 20f, 12f, 16f) }
            "check" -> poly(5f, 12f, 10f, 17f, 19f, 7f)
            "pin" -> {
                p.reset(); p.moveTo(12f, 21.5f); p.cubicTo(7f, 15.5f, 5f, 12.5f, 5f, 9.5f); p.arcTo(RectF(5f, 2.5f, 19f, 16.5f), 180f, 180f); p.cubicTo(19f, 12.5f, 17f, 15.5f, 12f, 21.5f); p.close()
                c.drawPath(p, paint); c.drawCircle(12f, 9.5f, 2.4f, paint)
            }
        }
        c.restore()
    }

    override fun setAlpha(a: Int) { paint.alpha = a; fill.alpha = a }
    override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf; fill.colorFilter = cf }
    @Deprecated("Required by Drawable") override fun getOpacity() = PixelFormat.TRANSLUCENT
}

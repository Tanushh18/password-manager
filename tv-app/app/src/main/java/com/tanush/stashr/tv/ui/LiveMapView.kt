package com.tanush.stashr.tv.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import android.view.animation.LinearInterpolator
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Ui

/**
 * A map without map tiles: home in the centre with distance rings, a pin for every family member who is out, the road
 * home drawn from the route the server sends, and a faint circle for how sure the phone is. North is up. Pins glide to
 * their new place over about a second whenever a fresh location arrives; the zoom fits everyone.
 */
class LiveMapView(ctx: Context) : View(ctx) {
    private val ui = Ui(ctx)
    private var map: Logic.LiveMap? = null
    private var fromXy = mapOf<String, Pair<Double, Double>>()      // where each pin was drawn before the update (metres from home)
    private var toXy = mapOf<String, Pair<Double, Double>>()
    private var fromScale = 0f
    private var toScale = 0f
    private var frac = 1f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply { duration = 1000; interpolator = LinearInterpolator(); addUpdateListener { frac = it.animatedValue as Float; invalidate() } }

    val palette = intArrayOf(Color.parseColor("#3987E5"), Color.parseColor("#D95926"), Color.parseColor("#30A46C"), Color.parseColor("#D4A72C"),
        Color.parseColor("#B07AE0"), Color.parseColor("#2BB3B1"), Color.parseColor("#E5484D"), Color.parseColor("#9BB0AB"))
    fun colorFor(index: Int) = palette[index % palette.size]

    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val pad get() = ui.dp(56).toFloat()

    fun show(m: Logic.LiveMap) {
        val home = m.home
        val newXy = if (home == null) emptyMap() else m.devices.associate { it.id to Logic.metres(home, it.lat, it.lon) }
        val pts = newXy.values.toList() + m.devices.flatMap { d -> d.route.map { r -> Logic.metres(home!!, r.first, r.second) } }.takeIf { home != null }.orEmpty()
        val sc = if (width > 0 && home != null) Logic.scaleFor(pts, width.toFloat(), height.toFloat(), pad) else 0f
        // Start the glide from wherever the pins are drawn right now.
        fromXy = toXy.mapValues { (id, v) -> val a = fromXy[id] ?: v; (a.first + (v.first - a.first) * frac) to (a.second + (v.second - a.second) * frac) }
        fromScale = if (toScale > 0f) fromScale + (toScale - fromScale) * frac else sc
        toXy = newXy; toScale = sc; map = m; frac = 0f
        anim.cancel(); anim.start()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) { super.onSizeChanged(w, h, ow, oh); map?.let { show(it) } }

    override fun onDetachedFromWindow() { anim.cancel(); super.onDetachedFromWindow() }

    override fun onDraw(c: Canvas) {
        val m = map ?: return
        val home = m.home ?: return
        val cx = width / 2f
        val cy = height / 2f
        val scale = if (fromScale > 0f) fromScale + (toScale - fromScale) * frac else toScale
        if (scale <= 0f) return
        fun pos(id: String): Pair<Double, Double>? {
            val b = toXy[id] ?: return null
            val a = fromXy[id] ?: b
            return (a.first + (b.first - a.first) * frac) to (a.second + (b.second - a.second) * frac)
        }
        val maxM = minOf(width, height) / 2f / scale - pad / scale

        // distance rings
        p.style = Paint.Style.STROKE; p.strokeWidth = ui.dp(1).toFloat(); p.color = ui.lineStrong; p.pathEffect = DashPathEffect(floatArrayOf(ui.dp(6).toFloat(), ui.dp(8).toFloat()), 0f)
        val rings = Logic.ringDistances(maxM.toDouble())
        for (r in rings) {
            c.drawCircle(cx, cy, (r * scale).toFloat(), p)
        }
        p.pathEffect = null
        p.style = Paint.Style.FILL; p.textSize = ui.dp(13).toFloat(); p.color = ui.faint; p.typeface = Typeface.DEFAULT
        for (r in rings) c.drawText(Logic.ringLabel(r), cx + (r * scale).toFloat() * 0.7071f + ui.dp(4), cy - (r * scale).toFloat() * 0.7071f - ui.dp(4), p)

        // routes first (under the pins)
        m.devices.forEachIndexed { i, d ->
            if (d.route.size < 2) return@forEachIndexed
            val col = colorFor(i)
            val pts = d.route.map { Logic.toScreen(Logic.metres(home, it.first, it.second), scale, cx, cy) }.toMutableList()
            // the line starts under the pin where it is drawn now
            pos(d.id)?.let { pts[0] = Logic.toScreen(it, scale, cx, cy) }
            val path = Path(); path.moveTo(pts[0].first, pts[0].second); for (k in 1 until pts.size) path.lineTo(pts[k].first, pts[k].second)
            p.style = Paint.Style.STROKE; p.strokeCap = Paint.Cap.ROUND; p.strokeJoin = Paint.Join.ROUND
            p.strokeWidth = ui.dp(9).toFloat(); p.color = ui.withAlpha(col, 0.18f); c.drawPath(path, p)
            p.strokeWidth = ui.dp(5).toFloat(); p.color = ui.withAlpha(col, 0.85f); c.drawPath(path, p)
            direction(c, pts, col)
        }

        // accuracy circles, then pins
        m.devices.forEachIndexed { i, d ->
            val xy = pos(d.id) ?: return@forEachIndexed
            val (sx, sy) = Logic.toScreen(xy, scale, cx, cy)
            val col = colorFor(i)
            val accPx = (d.acc * scale).coerceIn(0f, ui.dp(90).toFloat())
            if (accPx > ui.dp(10)) { p.style = Paint.Style.FILL; p.color = ui.withAlpha(col, 0.12f); c.drawCircle(sx, sy, accPx, p) }
            p.style = Paint.Style.FILL; p.color = Color.WHITE; c.drawCircle(sx, sy, ui.dp(15).toFloat(), p)
            p.color = if (Logic.freshness(d.ageSec) == Logic.Freshness.RED) ui.faint else col; c.drawCircle(sx, sy, ui.dp(11).toFloat(), p)
            label(c, Logic.firstName(d.name), sx, sy - ui.dp(24), col)
        }

        // home on top
        house(c, cx, cy)
        label(c, "Home", cx, cy + ui.dp(44), ui.accent)
    }

    /** Small chevrons along a line, pointing the way the line goes (towards home). */
    private fun direction(c: Canvas, pts: List<Pair<Float, Float>>, col: Int) {
        var carried = 0f; val every = ui.dp(70).toFloat()
        p.style = Paint.Style.STROKE; p.strokeWidth = ui.dp(3).toFloat(); p.color = Color.WHITE
        for (k in 1 until pts.size) {
            val (x0, y0) = pts[k - 1]; val (x1, y1) = pts[k]
            val len = Math.hypot((x1 - x0).toDouble(), (y1 - y0).toDouble()).toFloat()
            if (len < 1f) continue
            val ux = (x1 - x0) / len; val uy = (y1 - y0) / len
            var d = every - carried
            while (d <= len) {
                val x = x0 + ux * d; val y = y0 + uy * d; val s = ui.dp(6).toFloat()
                val path = Path(); path.moveTo(x - ux * s - uy * s, y - uy * s + ux * s); path.lineTo(x, y); path.lineTo(x - ux * s + uy * s, y - uy * s - ux * s)
                c.drawPath(path, p); d += every
            }
            carried = (carried + len) % every
        }
    }

    private fun label(c: Canvas, s: String, x: Float, y: Float, col: Int) {
        p.style = Paint.Style.FILL; p.textSize = ui.dp(17).toFloat(); p.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        val w = p.measureText(s); val padH = ui.dp(10).toFloat(); val h = ui.dp(28).toFloat()
        val r = RectF(x - w / 2 - padH, y - h / 2 - ui.dp(2), x + w / 2 + padH, y + h / 2 - ui.dp(2))
        p.color = ui.withAlpha(ui.bg, 0.85f); c.drawRoundRect(r, ui.dp(14).toFloat(), ui.dp(14).toFloat(), p)
        p.style = Paint.Style.STROKE; p.strokeWidth = ui.dp(2).toFloat(); p.color = col; c.drawRoundRect(r, ui.dp(14).toFloat(), ui.dp(14).toFloat(), p)
        p.style = Paint.Style.FILL; p.color = ui.text; c.drawText(s, x - w / 2, r.centerY() + p.textSize * 0.35f, p)
    }

    private fun house(c: Canvas, cx: Float, cy: Float) {
        val s = ui.dp(20).toFloat()
        p.style = Paint.Style.FILL; p.color = ui.accent
        val roof = Path(); roof.moveTo(cx - s, cy - s * 0.1f); roof.lineTo(cx, cy - s); roof.lineTo(cx + s, cy - s * 0.1f); roof.close(); c.drawPath(roof, p)
        c.drawRect(cx - s * 0.7f, cy - s * 0.1f, cx + s * 0.7f, cy + s * 0.8f, p)
        p.color = ui.bg; c.drawRect(cx - s * 0.18f, cy + s * 0.25f, cx + s * 0.18f, cy + s * 0.8f, p)
    }
}

package com.tanush.stashr.hub.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import com.tanush.stashr.hub.core.HouseMapLogic
import com.tanush.stashr.hub.core.HouseMapLogic.Block

/** Draws the house map (see HouseMapLogic) as flat blocks (2D) or isometric boxes (3D). A diagram of zones, not a floor plan. */
class HouseMapView(ctx: Context) : View(ctx) {
    var blocks: List<Block> = emptyList(); set(v) { field = v; invalidate() }
    var threeD = false; set(v) { field = v; invalidate() }

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3f; color = 0xFF6366F1.toInt() }
    private val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE5E7EB.toInt(); textSize = 34f; isFakeBoldText = true }
    private val hint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF9CA3AF.toInt(); textSize = 24f }
    private fun dotColor(kind: String) = when (kind) { "person" -> 0xFF3B82F6.toInt(); "hub" -> 0xFFA855F7.toInt(); "device-up" -> 0xFF22C55E.toInt(); else -> 0xFF9CA3AF.toInt() }

    private fun dot(c: Canvas, x: Float, y: Float, r: Float, kind: String) {
        fill.color = dotColor(kind); c.drawCircle(x, y, r, fill)
        line.color = 0xFF111827.toInt(); line.strokeWidth = 3f; c.drawCircle(x, y, r, line); line.color = 0xFF6366F1.toInt()
    }

    override fun onDraw(c: Canvas) {
        if (blocks.isEmpty()) { title.textAlign = Paint.Align.CENTER; c.drawText("Abhi koi zone nahi mila", width / 2f, height / 2f, title); return }
        if (threeD) draw3d(c) else draw2d(c)
    }

    private fun draw2d(c: Canvas) {
        val (ew, eh) = HouseMapLogic.extent(blocks)
        val pad = 24f
        val s = minOf((width - pad * 2) / ew, (height - pad * 2) / eh).toFloat()
        title.textAlign = Paint.Align.LEFT
        for (b in blocks) {
            val r = RectF(pad + (b.x * s).toFloat(), pad + (b.y * s).toFloat(), pad + ((b.x + b.w) * s).toFloat(), pad + ((b.y + b.h) * s).toFloat())
            fill.color = if (b.labelOnly) 0xFF22262E.toInt() else 0xFF22263D.toInt()
            c.drawRoundRect(r, 24f, 24f, fill)
            line.color = if (b.labelOnly) 0xFF4B5563.toInt() else 0xFF6366F1.toInt(); c.drawRoundRect(r, 24f, 24f, line)
            c.drawText(b.name, r.left + 18f, r.top + 42f, title)
            if (b.hint.isNotEmpty()) c.drawText(b.hint, r.left + 18f, r.top + 74f, hint)
            b.markers.forEachIndexed { i, m -> dot(c, r.left + 36f + (i % 5) * 62f, r.bottom - 36f - (i / 5) * 62f, 22f, m.kind) }
        }
    }

    private fun draw3d(c: Canvas) {
        // fit: measure the picture at scale 1, then scale it to the view
        val corners = ArrayList<Pair<Double, Double>>()
        for (b in blocks) for ((cx, cy) in listOf(b.x to b.y, b.x + b.w to b.y, b.x + b.w to b.y + b.h, b.x to b.y + b.h)) {
            corners.add(HouseMapLogic.isoX(cx, cy, 1.0) to HouseMapLogic.isoY(cx, cy, HouseMapLogic.BLOCK_H, 1.0))
            corners.add(HouseMapLogic.isoX(cx, cy, 1.0) to HouseMapLogic.isoY(cx, cy, 0.0, 1.0))
        }
        val minX = corners.minOf { it.first }; val maxX = corners.maxOf { it.first }; val minY = corners.minOf { it.second }; val maxY = corners.maxOf { it.second }
        val pad = 30.0
        val s = minOf((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY))
        val ox = pad - minX * s + ((width - pad * 2) - (maxX - minX) * s) / 2; val oy = pad - minY * s + ((height - pad * 2) - (maxY - minY) * s) / 2
        fun px(x: Double, y: Double) = (ox + HouseMapLogic.isoX(x, y, s)).toFloat()
        fun py(x: Double, y: Double, z: Double) = (oy + HouseMapLogic.isoY(x, y, z, s)).toFloat()
        fun face(c: Canvas, pts: List<Pair<Float, Float>>, color: Int, edge: Int) {
            val p = Path(); pts.forEachIndexed { i, (x, y) -> if (i == 0) p.moveTo(x, y) else p.lineTo(x, y) }; p.close()
            fill.color = color; c.drawPath(p, fill); line.color = edge; line.strokeWidth = 2.5f; c.drawPath(p, line)
        }
        title.textAlign = Paint.Align.CENTER
        for (b in HouseMapLogic.backToFront(blocks)) {
            val z = HouseMapLogic.BLOCK_H
            val edge = if (b.labelOnly) 0xFF4B5563.toInt() else 0xFF6366F1.toInt()
            val top = if (b.labelOnly) 0xFF2A2F38.toInt() else 0xFF2A2F55.toInt()
            val left = if (b.labelOnly) 0xFF383E49.toInt() else 0xFF3C4291.toInt()
            val right = if (b.labelOnly) 0xFF4A515E.toInt() else 0xFF4F56B4.toInt()
            val x0 = b.x; val y0 = b.y; val x1 = b.x + b.w; val y1 = b.y + b.h
            face(c, listOf(px(x0, y1) to py(x0, y1, z), px(x1, y1) to py(x1, y1, z), px(x1, y1) to py(x1, y1, 0.0), px(x0, y1) to py(x0, y1, 0.0)), left, edge)
            face(c, listOf(px(x1, y1) to py(x1, y1, z), px(x1, y0) to py(x1, y0, z), px(x1, y0) to py(x1, y0, 0.0), px(x1, y1) to py(x1, y1, 0.0)), right, edge)
            face(c, listOf(px(x0, y0) to py(x0, y0, z), px(x1, y0) to py(x1, y0, z), px(x1, y1) to py(x1, y1, z), px(x0, y1) to py(x0, y1, z)), top, edge)
            c.drawText(b.name, px(x0 + b.w / 2, y0 + b.h / 2), py(x0 + b.w / 2, y0 + b.h / 2, z) - 14f, title)
            b.markers.forEachIndexed { i, m -> dot(c, px(x0 + 0.35 + (i % 4) * 0.42, y0 + 1.45 + (i / 4) * 0.34), py(x0 + 0.35 + (i % 4) * 0.42, y0 + 1.45 + (i / 4) * 0.34, z + 0.12), 18f, m.kind) }
        }
    }
}

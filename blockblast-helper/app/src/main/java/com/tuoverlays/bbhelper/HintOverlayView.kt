package com.tuoverlays.bbhelper

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.tuoverlays.bbhelper.core.Board
import com.tuoverlays.bbhelper.core.Box
import com.tuoverlays.bbhelper.core.Plan
import com.tuoverlays.bbhelper.core.Snapshot

/**
 * Прозрачный слой поверх игры: контуры клеток, куда ставить фигуры, и номера ходов.
 * Центры клеток не закрашиваются — иначе подсказки попадут в захват экрана и собьют распознавание.
 */
class HintOverlayView(context: Context) : View(context) {

    private val density = resources.displayMetrics.density
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3.5f * density
    }
    private val badge = Paint(Paint.ANTI_ALIAS_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
        textSize = 13f * density
    }
    private val status = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        textSize = 14f * density
        setShadowLayer(4f, 0f, 0f, 0xFF000000.toInt())
    }
    private val dashed = DashPathEffect(floatArrayOf(10f * density, 6f * density), 0f)
    private val loc = IntArray(2)
    private val rect = RectF()

    private var plan: Plan? = null
    private var board: Box? = null
    private var tray: Box? = null
    private var message: String? = null
    private var preview: Snapshot? = null
    private val hidePreview = Runnable { preview = null; invalidate() }

    private val cellOn = Paint().apply { color = 0xFFFFFFFF.toInt() }
    private val cellOff = Paint().apply { color = 0xFF303030.toInt() }
    private val panel = Paint().apply { color = 0xF0000000.toInt() }

    fun show(plan: Plan?, board: Box, tray: Box, prefix: String? = null) {
        this.plan = plan; this.board = board; this.tray = tray
        val text = when {
            plan == null -> "Фигуры не найдены"
            plan.moves.isEmpty() -> "Ходов нет"
            !plan.placedAll -> "Поместится фигур: ${plan.moves.size}"
            else -> null
        }
        message = listOfNotNull(prefix, text).joinToString(" · ").ifEmpty { null }
        invalidate()
    }

    fun showMessage(text: String, board: Box, tray: Box) {
        this.board = board; this.tray = tray
        plan = null; message = text
        invalidate()
    }

    /** Контрастная схема того, что распознано: поле 8×8 и три фигуры (белое — блок). */
    fun showPreview(snapshot: Snapshot, board: Box, tray: Box) {
        this.board = board; this.tray = tray
        preview = snapshot
        removeCallbacks(hidePreview)
        postDelayed(hidePreview, PREVIEW_MS)
        invalidate()
    }

    fun clear() {
        if (plan == null && message == null) return
        plan = null; message = null
        invalidate()
    }

    private fun drawPreview(canvas: Canvas, s: Snapshot, b: Box, t: Box) {
        val cs = 9 * density
        val gap = 1 * density
        val pad = 6 * density
        val pcs = 7 * density
        val w = pad * 2 + cs * 8 + (pad + pcs * 5) * 3
        val h = pad * 2 + cs * 8
        // Над полем, если есть место (ниже статус-бара), иначе под лотком.
        val top = if (b.top - 30 * density - h > 28 * density) b.top - 30 * density - h else t.bottom + 12 * density
        val left = b.left
        canvas.drawRect(left, top, left + w, top + h, panel)
        for (r in 0 until 8) for (c in 0 until 8) {
            val x = left + pad + c * cs
            val y = top + pad + r * cs
            canvas.drawRect(x, y, x + cs - gap, y + cs - gap, if (Board.isSet(s.board, r, c)) cellOn else cellOff)
        }
        s.pieces.forEachIndexed { i, p ->
            val ox = left + pad + cs * 8 + pad + i * (pad + pcs * 5)
            val oy = top + pad
            for (r in 0 until 5) for (c in 0 until 5) {
                val on = p != null && r < p.height && c < p.width && Board.isSet(p.mask, r, c)
                val x = ox + c * pcs
                val y = oy + r * pcs
                canvas.drawRect(x, y, x + pcs - gap, y + pcs - gap, if (on) cellOn else cellOff)
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        val b = board ?: return
        getLocationOnScreen(loc)
        canvas.translate(-loc[0].toFloat(), -loc[1].toFloat())

        preview?.let { s -> tray?.let { t -> drawPreview(canvas, s, b, t) } }
        message?.let { canvas.drawText(it, b.left + b.width / 2, b.top - 12 * density, status) }
        val p = plan ?: return
        val cell = b.width / 8
        val inset = cell * 0.08f

        p.moves.forEachIndexed { i, m ->
            val color = COLORS[i % COLORS.size]
            stroke.color = color
            stroke.pathEffect = if (i == 0) null else dashed
            for (c in m.piece.cells) {
                val x = b.left + (m.col + c.col) * cell
                val y = b.top + (m.row + c.row) * cell
                rect.set(x + inset, y + inset, x + cell - inset, y + cell - inset)
                canvas.drawRoundRect(rect, cell * 0.12f, cell * 0.12f, stroke)
            }
            // Номер хода — в самом углу первой клетки фигуры, чтобы не попасть в зону замера цвета (центр ±12%).
            val first = m.piece.cells.first()
            val bx = b.left + (m.col + first.col) * cell + cell * 0.2f
            val by = b.top + (m.row + first.row) * cell + cell * 0.2f
            drawBadge(canvas, bx, by, cell * 0.12f, color, (i + 1).toString())

            // Тот же номер над фигурой в лотке, чтобы было видно, какую брать.
            tray?.let { t ->
                val sx = t.left + t.width / 3 * (m.slot + 0.5f)
                drawBadge(canvas, sx, t.top - 12 * density, 11 * density, color, (i + 1).toString())
            }
        }
    }

    private fun drawBadge(canvas: Canvas, x: Float, y: Float, r: Float, color: Int, label: String) {
        badge.color = color
        canvas.drawCircle(x, y, r, badge)
        text.textSize = r * 1.3f
        canvas.drawText(label, x, y - (text.descent() + text.ascent()) / 2, text)
    }

    companion object {
        private const val PREVIEW_MS = 6000L
        val COLORS = intArrayOf(0xFF00E676.toInt(), 0xFFFFD600.toInt(), 0xFFFF4081.toInt())
    }
}

package com.tuoverlays.bbhelper

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View
import com.tuoverlays.bbhelper.core.Box
import kotlin.math.max

/**
 * Разметка: зелёную рамку совместить с полем 8×8, оранжевую — с зоной трёх фигур.
 * Тянуть за рамку — двигать, за кружок в правом нижнем углу — менять размер.
 */
class CalibrationView(context: Context, board: Box, tray: Box) : View(context) {

    var board = board; private set
    var tray = tray; private set

    private val density = resources.displayMetrics.density
    private val handleR = 16 * density
    private val loc = IntArray(2)

    private val dim = Paint().apply { color = 0x66000000 }
    private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f * density }
    private val grid = Paint().apply { strokeWidth = 1f * density }
    private val handle = Paint(Paint.ANTI_ALIAS_FLAG)
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt(); textSize = 14 * density
        setShadowLayer(4f, 0f, 0f, 0xFF000000.toInt())
    }

    private enum class Target { BOARD_MOVE, BOARD_RESIZE, TRAY_MOVE, TRAY_RESIZE }
    private var target: Target? = null
    private var lastX = 0f
    private var lastY = 0f

    override fun onDraw(canvas: Canvas) {
        getLocationOnScreen(loc)
        canvas.translate(-loc[0].toFloat(), -loc[1].toFloat())
        canvas.drawRect(loc[0].toFloat(), loc[1].toFloat(), loc[0] + width.toFloat(), loc[1] + height.toFloat(), dim)

        drawBox(canvas, board, 0xFF00E676.toInt(), "Поле 8×8")
        val cell = board.width / 8
        grid.color = 0x8800E676.toInt()
        for (i in 1 until 8) {
            canvas.drawLine(board.left + i * cell, board.top, board.left + i * cell, board.bottom, grid)
            canvas.drawLine(board.left, board.top + i * cell, board.right, board.top + i * cell, grid)
        }

        drawBox(canvas, tray, 0xFFFF9100.toInt(), "Фигуры")
        grid.color = 0x88FF9100.toInt()
        for (i in 1 until 3) {
            val x = tray.left + tray.width / 3 * i
            canvas.drawLine(x, tray.top, x, tray.bottom, grid)
        }
    }

    private fun drawBox(canvas: Canvas, b: Box, color: Int, text: String) {
        frame.color = color
        canvas.drawRect(b.left, b.top, b.right, b.bottom, frame)
        handle.color = color
        canvas.drawCircle(b.right, b.bottom, handleR, handle)
        canvas.drawText(text, b.left + 6 * density, b.top - 6 * density, label)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val x = e.rawX
        val y = e.rawY
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                target = when {
                    near(x, y, board.right, board.bottom) -> Target.BOARD_RESIZE
                    near(x, y, tray.right, tray.bottom) -> Target.TRAY_RESIZE
                    inside(x, y, board) -> Target.BOARD_MOVE
                    inside(x, y, tray) -> Target.TRAY_MOVE
                    else -> null
                }
                lastX = x; lastY = y
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = x - lastX
                val dy = y - lastY
                lastX = x; lastY = y
                val min = 40 * density
                when (target) {
                    Target.BOARD_MOVE -> board = board.copy(left = board.left + dx, top = board.top + dy, right = board.right + dx, bottom = board.bottom + dy)
                    Target.BOARD_RESIZE -> {
                        // Поле квадратное: меняем сторону по большему смещению.
                        val side = max(min, max(x - board.left, y - board.top))
                        board = board.copy(right = board.left + side, bottom = board.top + side)
                    }
                    Target.TRAY_MOVE -> tray = tray.copy(left = tray.left + dx, top = tray.top + dy, right = tray.right + dx, bottom = tray.bottom + dy)
                    Target.TRAY_RESIZE -> tray = tray.copy(right = max(tray.left + min, x), bottom = max(tray.top + min, y))
                    null -> {}
                }
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> target = null
        }
        return true
    }

    private fun near(x: Float, y: Float, px: Float, py: Float): Boolean {
        val r = handleR * 2
        return (x - px) * (x - px) + (y - py) * (y - py) <= r * r
    }

    private fun inside(x: Float, y: Float, b: Box) = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

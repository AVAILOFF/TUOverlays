package com.tuoverlays.bbhelper.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** Источник пикселей (кадр с экрана). rgb = 0xRRGGBB. */
interface PixelSource {
    val width: Int
    val height: Int
    fun rgb(x: Int, y: Int): Int
}

/** Прямоугольник в пикселях экрана. */
data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
}

/** Что распознано на кадре: поле и фигуры в трёх слотах лотка. */
data class Snapshot(val board: Long, val pieces: List<Piece?>) {
    val hasPieces get() = pieces.any { it != null }
}

object Vision {

    /** Насколько цвет должен отличаться от фона (сумма |dR|+|dG|+|dB|), чтобы считаться блоком. */
    var colorThreshold = 110

    /**
     * contrast = true — «контрастный» режим для ручного анализа: порог «блок / фон» подбирается
     * по самому кадру (метод Оцу), а не берётся фиксированный. Ловит тусклые и бледные фигуры.
     */
    fun read(src: PixelSource, board: Box, tray: Box, scale: TrayScale = TrayScale(), contrast: Boolean = false): Snapshot =
        Snapshot(readBoard(src, board, contrast), readTray(src, tray, board.width / Board.SIZE, scale, contrast))

    fun readBoard(src: PixelSource, board: Box, contrast: Boolean = false): Long {
        val cell = board.width / Board.SIZE
        val colors = IntArray(64)
        for (r in 0 until Board.SIZE) for (c in 0 until Board.SIZE) {
            // Берём только центр клетки: там не рисуются рамки и номера подсказок.
            colors[r * 8 + c] = averageColor(
                src,
                board.left + (c + 0.5f) * cell,
                board.top + (r + 0.5f) * cell,
                cell * 0.12f,
            )
        }
        // Самая тёмная клетка почти наверняка пустая — это эталон фона поля.
        val empty = colors.minBy { luma(it) }
        val d = IntArray(64) { dist(colors[it], empty) }
        val threshold = if (contrast) adaptiveThreshold(d) else colorThreshold
        var mask = 0L
        for (i in 0 until 64) if (d[i] > threshold) mask = mask or (1L shl i)
        return mask
    }

    fun readTray(src: PixelSource, tray: Box, boardCell: Float, scale: TrayScale = TrayScale(), contrast: Boolean = false): List<Piece?> {
        val slotW = tray.width / 3
        val blobs = (0 until 3).map {
            findBlob(src, Box(tray.left + it * slotW, tray.top, tray.left + (it + 1) * slotW, tray.bottom), contrast)
        }
        val found = blobs.filterNotNull()
        if (found.isEmpty()) return listOf(null, null, null)
        val dims = found.flatMap { listOf(it.box.width / boardCell, it.box.height / boardCell) }
        val unit = scale.update(dims) * boardCell
        return blobs.map { blob -> blob?.let { toPiece(src, it, unit) } }
    }

    private class Blob(val box: Box, val bg: Int, val threshold: Int)

    private fun findBlob(src: PixelSource, slot: Box, contrast: Boolean): Blob? {
        val bg = borderColor(src, slot)
        val step = max(1f, slot.width / 90f)
        val cols = ((slot.width) / step).toInt()
        val rows = ((slot.height) / step).toInt()
        if (cols <= 0 || rows <= 0) return null
        val d = IntArray(rows * cols)
        for (j in 0 until rows) for (i in 0 until cols) {
            d[j * cols + i] = dist(sample(src, slot.left + (i + 0.5f) * step, slot.top + (j + 0.5f) * step), bg)
        }
        val threshold = if (contrast) adaptiveThreshold(d) else colorThreshold
        val rowHits = IntArray(rows)
        val colHits = IntArray(cols)
        var total = 0
        for (j in 0 until rows) for (i in 0 until cols) {
            if (d[j * cols + i] > threshold) { rowHits[j]++; colHits[i]++; total++ }
        }
        if (total < 8) return null
        val minHits = 2
        val r0 = rowHits.indexOfFirst { it >= minHits }
        val r1 = rowHits.indexOfLast { it >= minHits }
        val c0 = colHits.indexOfFirst { it >= minHits }
        val c1 = colHits.indexOfLast { it >= minHits }
        if (r0 < 0 || c0 < 0) return null
        return Blob(
            Box(slot.left + c0 * step, slot.top + r0 * step, slot.left + (c1 + 1) * step, slot.top + (r1 + 1) * step),
            bg,
            threshold,
        )
    }

    private fun toPiece(src: PixelSource, blob: Blob, unit: Float): Piece? {
        val nc = (blob.box.width / unit).roundToInt().coerceIn(1, 5)
        val nr = (blob.box.height / unit).roundToInt().coerceIn(1, 5)
        val cw = blob.box.width / nc
        val ch = blob.box.height / nr
        val cells = mutableListOf<Cell>()
        for (r in 0 until nr) for (c in 0 until nc) {
            val cx = blob.box.left + (c + 0.5f) * cw
            val cy = blob.box.top + (r + 0.5f) * ch
            var hits = 0
            for (dy in -1..1) for (dx in -1..1) {
                if (dist(sample(src, cx + dx * cw * 0.2f, cy + dy * ch * 0.2f), blob.bg) > blob.threshold) hits++
            }
            if (hits >= 5) cells += Cell(r, c)
        }
        return Piece.of(cells)
    }

    /**
     * Порог Оцу по расстояниям до фона: делит значения на «фон» и «блоки» с максимальным разрывом.
     * Если всё почти одинаковое (разброс < 60) — блоков нет.
     */
    fun adaptiveThreshold(values: IntArray): Int {
        val maxV = values.maxOrNull() ?: return Int.MAX_VALUE
        if (maxV < MIN_SPREAD) return Int.MAX_VALUE
        val hist = IntArray(maxV + 1)
        for (v in values) hist[v]++
        val total = values.size.toDouble()
        var sumAll = 0.0
        for (v in hist.indices) sumAll += v.toDouble() * hist[v]
        var wB = 0.0; var sumB = 0.0; var best = -1.0; var thr = 0
        for (t in hist.indices) {
            wB += hist[t]
            if (wB == 0.0) continue
            val wF = total - wB
            if (wF == 0.0) break
            sumB += t.toDouble() * hist[t]
            val mB = sumB / wB
            val mF = (sumAll - sumB) / wF
            val between = wB * wF * (mB - mF) * (mB - mF)
            if (between > best) { best = between; thr = t }
        }
        return max(thr, MIN_CONTRAST_THRESHOLD)
    }

    private const val MIN_SPREAD = 60
    private const val MIN_CONTRAST_THRESHOLD = 40

    private fun borderColor(src: PixelSource, b: Box): Int {
        val rs = ArrayList<Int>(); val gs = ArrayList<Int>(); val bs = ArrayList<Int>()
        fun add(c: Int) { rs += (c shr 16) and 0xFF; gs += (c shr 8) and 0xFF; bs += c and 0xFF }
        val n = 24
        for (i in 0..n) {
            val x = b.left + (b.width - 1) * i / n
            val y = b.top + (b.height - 1) * i / n
            add(sample(src, x, b.top + 1)); add(sample(src, x, b.bottom - 2))
            add(sample(src, b.left + 1, y)); add(sample(src, b.right - 2, y))
        }
        rs.sort(); gs.sort(); bs.sort()
        val m = rs.size / 2
        return (rs[m] shl 16) or (gs[m] shl 8) or bs[m]
    }

    private fun averageColor(src: PixelSource, cx: Float, cy: Float, radius: Float): Int {
        var r = 0; var g = 0; var b = 0; var n = 0
        for (dy in -2..2) for (dx in -2..2) {
            val c = sample(src, cx + dx * radius / 2, cy + dy * radius / 2)
            r += (c shr 16) and 0xFF; g += (c shr 8) and 0xFF; b += c and 0xFF; n++
        }
        return ((r / n) shl 16) or ((g / n) shl 8) or (b / n)
    }

    private fun sample(src: PixelSource, x: Float, y: Float): Int =
        src.rgb(x.toInt().coerceIn(0, src.width - 1), y.toInt().coerceIn(0, src.height - 1))

    fun dist(a: Int, b: Int): Int =
        abs(((a shr 16) and 0xFF) - ((b shr 16) and 0xFF)) +
            abs(((a shr 8) and 0xFF) - ((b shr 8) and 0xFF)) +
            abs((a and 0xFF) - (b and 0xFF))

    private fun luma(c: Int): Int = ((c shr 16) and 0xFF) * 3 + ((c shr 8) and 0xFF) * 6 + (c and 0xFF)
}

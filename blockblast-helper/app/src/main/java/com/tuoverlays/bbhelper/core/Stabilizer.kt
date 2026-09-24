package com.tuoverlays.bbhelper.core

/**
 * Сглаживает распознавание по последним кадрам: клетка поля считается занятой, если занята
 * в большинстве кадров, фигура в слоте — та, что встречалась чаще всего.
 * Так одна «мигающая» клетка (анимация, блик) не сбрасывает подсказки и не мешает расчёту.
 */
class Stabilizer(private val window: Int = 5) {

    private val history = ArrayDeque<Snapshot>()

    /** Возвращает сглаженный снимок или null, пока кадров мало или картинка ещё не устоялась. */
    fun push(s: Snapshot): Snapshot? {
        history.addLast(s)
        while (history.size > window) history.removeFirst()
        val n = history.size
        val need = n / 2 + 1
        if (n < 3) return null

        var board = 0L
        for (bit in 0 until 64) {
            val m = 1L shl bit
            if (history.count { it.board and m != 0L } >= need) board = board or m
        }

        val pieces = ArrayList<Piece?>(3)
        for (slot in 0 until 3) {
            val (piece, count) = history
                .groupingBy { it.pieces.getOrNull(slot) }
                .eachCount()
                .maxByOrNull { it.value }!!
            // Нет явного большинства — слот ещё в движении (фигуру тянут или она появляется).
            if (count < need) return null
            pieces += piece
        }
        return Snapshot(board, pieces)
    }

    fun reset() = history.clear()
}

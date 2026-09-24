package com.tuoverlays.bbhelper.core

/**
 * Следит за комбо по последовательности распознанных кадров: какая фигура ушла из лотка
 * и уменьшилось ли число занятых клеток сильнее, чем добавила фигура (значит, была очистка).
 */
class ComboTracker {

    var state = ComboState()
        private set

    private var prev: Snapshot? = null

    fun update(next: Snapshot) {
        val p = prev
        prev = next
        if (p == null || p == next) return
        val placed = placedPiece(p, next)
        val before = java.lang.Long.bitCount(p.board)
        val after = java.lang.Long.bitCount(next.board)
        if (placed == null) {
            // Поле опустело без постановки — новая игра.
            if (next.board == 0L && before > 0) state = ComboState()
            return
        }
        state = if (after < before + placed.cells.size) {
            ComboState(state.combo + 1, 0)
        } else {
            val since = state.sinceClear + 1
            if (since >= 3) ComboState(0, 3) else ComboState(state.combo, since)
        }
    }

    fun reset() {
        state = ComboState(); prev = null
    }

    /** Фигура, которую поставили между кадрами, или null, если это не похоже на один ход. */
    private fun placedPiece(a: Snapshot, b: Snapshot): Piece? {
        val gone = (0 until 3).filter { a.pieces.getOrNull(it) != null && b.pieces.getOrNull(it) == null }
        val kept = (0 until 3).filter { a.pieces.getOrNull(it) != null && a.pieces.getOrNull(it) == b.pieces.getOrNull(it) }
        val aCount = a.pieces.count { it != null }
        val bCount = b.pieces.count { it != null }
        return when {
            gone.size == 1 && kept.size == aCount - 1 && a.board != b.board -> a.pieces[gone[0]]
            // Поставили последнюю фигуру — лоток сразу заполнился новыми.
            aCount == 1 && bCount == 3 && a.board != b.board -> a.pieces.first { it != null }
            else -> null
        }
    }
}

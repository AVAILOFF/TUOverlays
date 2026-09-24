package com.tuoverlays.bbhelper.core

/**
 * Поле 8×8 хранится в Long: бит (row * 8 + col) = занятая клетка.
 */
object Board {
    const val SIZE = 8

    val ROWS = LongArray(SIZE) { 0xFFL shl (it * SIZE) }
    val COLS = LongArray(SIZE) { 0x0101010101010101L shl it }

    fun bit(row: Int, col: Int): Long = 1L shl (row * SIZE + col)

    fun isSet(board: Long, row: Int, col: Int): Boolean = board and bit(row, col) != 0L

    /** Ставит фигуру и очищает заполненные ряды/столбцы. Возвращает (новое поле, число линий). */
    fun place(board: Long, pieceMask: Long): Pair<Long, Int> {
        val filled = board or pieceMask
        var clear = 0L
        var lines = 0
        for (i in 0 until SIZE) {
            if (filled and ROWS[i] == ROWS[i]) { clear = clear or ROWS[i]; lines++ }
            if (filled and COLS[i] == COLS[i]) { clear = clear or COLS[i]; lines++ }
        }
        return (filled and clear.inv()) to lines
    }

    fun parse(vararg rows: String): Long {
        var b = 0L
        rows.forEachIndexed { r, line ->
            line.forEachIndexed { c, ch -> if (ch == '#' || ch == 'X') b = b or bit(r, c) }
        }
        return b
    }

    fun toString(board: Long): String = buildString {
        for (r in 0 until SIZE) {
            for (c in 0 until SIZE) append(if (isSet(board, r, c)) '#' else '.')
            if (r < SIZE - 1) append('\n')
        }
    }
}

data class Cell(val row: Int, val col: Int)

/** Фигура, нормализованная к левому верхнему углу. */
class Piece private constructor(val mask: Long, val width: Int, val height: Int) {
    val cells: List<Cell> = buildList {
        for (r in 0 until height) for (c in 0 until width) if (Board.isSet(mask, r, c)) add(Cell(r, c))
    }

    fun maskAt(row: Int, col: Int): Long = mask shl (row * Board.SIZE + col)

    override fun equals(other: Any?) = other is Piece && other.mask == mask
    override fun hashCode() = mask.hashCode()
    override fun toString() = Board.toString(mask).lines().take(height).joinToString("\n") { it.take(width) }

    companion object {
        fun of(cells: Collection<Cell>): Piece? {
            if (cells.isEmpty()) return null
            val minR = cells.minOf { it.row }
            val minC = cells.minOf { it.col }
            val h = cells.maxOf { it.row } - minR + 1
            val w = cells.maxOf { it.col } - minC + 1
            if (w > Board.SIZE || h > Board.SIZE) return null
            var m = 0L
            for (cell in cells) m = m or Board.bit(cell.row - minR, cell.col - minC)
            return Piece(m, w, h)
        }

        fun parse(vararg rows: String): Piece {
            val cells = mutableListOf<Cell>()
            rows.forEachIndexed { r, line ->
                line.forEachIndexed { c, ch -> if (ch == '#' || ch == 'X') cells += Cell(r, c) }
            }
            return requireNotNull(of(cells)) { "empty piece" }
        }
    }
}

/** slot — индекс фигуры в лотке (0..2), row/col — куда ставить левый верхний угол фигуры. */
data class Move(val slot: Int, val piece: Piece, val row: Int, val col: Int, val lines: Int)

data class Plan(val moves: List<Move>, val placedAll: Boolean, val score: Int)

/**
 * Перебирает все порядки и позиции для фигур лотка (до 3! * 64³ вариантов)
 * и выбирает последовательность с максимумом поставленных фигур, затем — по оценке.
 */
object Solver {

    private const val NOT_COL0 = 0x0101010101010101L.inv()
    private const val NOT_COL7 = (0x0101010101010101L shl 7).inv()
    private const val NOT_ROW7 = 0x00FFFFFFFFFFFFFFL

    fun solve(board: Long, pieces: List<Piece?>): Plan? {
        val slots = pieces.indices.filter { pieces[it] != null }
        if (slots.isEmpty()) return null
        return Search(board, pieces, slots).run()
    }

    private class Search(val start: Long, val pieces: List<Piece?>, val slots: List<Int>) {
        val curSlot = IntArray(3); val curRow = IntArray(3); val curCol = IntArray(3); val curLines = IntArray(3)
        val bestSlot = IntArray(3); val bestRow = IntArray(3); val bestCol = IntArray(3); val bestLines = IntArray(3)
        var bestDepth = -1
        var bestScore = Int.MIN_VALUE

        fun run(): Plan? {
            rec(start, 0, 0, 0, 0)
            if (bestDepth <= 0) return Plan(emptyList(), false, bestScore)
            val moves = (0 until bestDepth).map {
                Move(bestSlot[it], pieces[bestSlot[it]]!!, bestRow[it], bestCol[it], bestLines[it])
            }
            return Plan(moves, bestDepth == slots.size, bestScore)
        }

        fun rec(board: Long, used: Int, depth: Int, gained: Int, streak: Int) {
            var moved = false
            val tried = ArrayList<Long>(3)
            for (s in slots) {
                if (used and (1 shl s) != 0) continue
                val p = pieces[s]!!
                if (p.mask in tried) continue
                tried += p.mask
                for (r in 0..Board.SIZE - p.height) for (c in 0..Board.SIZE - p.width) {
                    val pm = p.maskAt(r, c)
                    if (board and pm != 0L) continue
                    moved = true
                    val (next, lines) = Board.place(board, pm)
                    val bonus = if (lines > 0) lines * 20 + lines * lines * 10 + streak * 15 else 0
                    curSlot[depth] = s; curRow[depth] = r; curCol[depth] = c; curLines[depth] = lines
                    rec(next, used or (1 shl s), depth + 1, gained + bonus, if (lines > 0) streak + 1 else 0)
                }
            }
            if (!moved) leaf(board, depth, gained)
        }

        fun leaf(board: Long, depth: Int, gained: Int) {
            val score = gained + evaluate(board)
            if (depth > bestDepth || (depth == bestDepth && score > bestScore)) {
                bestDepth = depth; bestScore = score
                for (i in 0 until depth) {
                    bestSlot[i] = curSlot[i]; bestRow[i] = curRow[i]; bestCol[i] = curCol[i]; bestLines[i] = curLines[i]
                }
            }
        }
    }

    /** Оценка позиции: больше свободного места, меньше «рваности» и одиночных дыр, есть место под крупные фигуры. */
    fun evaluate(board: Long): Int {
        val e = board.inv()
        val empties = java.lang.Long.bitCount(e)

        val nb = ((e ushr 1) and NOT_COL7) or ((e shl 1) and NOT_COL0) or (e shl 8) or (e ushr 8)
        val isolated = java.lang.Long.bitCount(e and nb.inv())

        val hTrans = java.lang.Long.bitCount((board xor (board ushr 1)) and NOT_COL7)
        val vTrans = java.lang.Long.bitCount((board xor (board ushr 8)) and NOT_ROW7)

        val h2 = e and (e ushr 1) and NOT_COL7
        val sq2 = h2 and (h2 ushr 8)
        val h3 = h2 and (e ushr 2) and (NOT_COL7 and (NOT_COL7 ushr 1))
        val sq3 = h3 and (h3 ushr 8) and (h3 ushr 16)
        val h5 = e and (e ushr 1) and (e ushr 2) and (e ushr 3) and (e ushr 4) and colsUpTo(3)
        val v5 = e and (e ushr 8) and (e ushr 16) and (e ushr 24) and (e ushr 32)

        var score = empties * 2 - (hTrans + vTrans) * 3 - isolated * 10
        if (sq2 == 0L) score -= 40
        if (sq3 == 0L) score -= 30
        if (h5 == 0L) score -= 12
        if (v5 == 0L) score -= 12
        return score
    }

    private fun colsUpTo(maxCol: Int): Long {
        var m = 0L
        for (c in 0..maxCol) m = m or Board.COLS[c]
        return m
    }
}

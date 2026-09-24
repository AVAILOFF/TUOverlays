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
 * Комбо в Block Blast: серия держится, пока линии очищаются хотя бы раз за 3 постановки.
 * combo — длина текущей серии, sinceClear — сколько постановок подряд прошло без очистки.
 */
data class ComboState(val combo: Int = 0, val sinceClear: Int = 0)

/** Веса оценки. Подобраны самоигрой в симуляторе (см. SimulatorTest). */
data class Weights(
    val line: Double = 7.5,
    val multi: Double = 30.0,
    val combo: Double = 2.5,
    val comboLoss: Double = 5.0,
    val empty: Double = 3.0,
    val transition: Double = 7.5,
    val isolated: Double = 10.5,
    val noSquare2: Double = 100.0,
    val noSquare3: Double = 0.0,
    val noLine5: Double = 0.0,
    val fitLoss: Double = 3.0,
    val mobility: Double = 0.0,
    /** Вес доли случайных будущих наборов фигур, которые удастся поставить целиком. */
    val lookahead: Double = 32.0,
    val lookaheadTop: Int = 16,
    val lookaheadSamples: Int = 64,
)

/**
 * Перебирает все порядки и позиции фигур лотка (до 3! × 64³ вариантов) с отсечением повторов.
 * Итоговые поля сначала грубо оцениваются дёшево, лучшие K — точно, с проверкой,
 * сколько фигур из всего набора игры на них ещё помещается.
 */
object Solver {

    private const val NOT_COL0 = 0x0101010101010101L.inv()
    private const val NOT_COL7 = (0x0101010101010101L shl 7).inv()
    private const val COL0 = 0x0101010101010101L
    private const val COL7 = 0x0101010101010101L shl 7
    private const val ROW0 = 0xFFL
    private const val ROW7 = 0xFFL shl 56
    private const val NOT_ROW7 = 0x00FFFFFFFFFFFFFFL
    private const val TOP_K = 96

    fun solve(
        board: Long,
        pieces: List<Piece?>,
        combo: ComboState = ComboState(),
        weights: Weights = Weights(),
    ): Plan? {
        val slots = pieces.indices.filter { pieces[it] != null }
        if (slots.isEmpty()) return null
        return Search(board, pieces, slots, combo, weights).run()
    }

    private class Leaf(val board: Long, val depth: Int, val gained: Double, val path: Int) {
        var score = 0.0
    }

    private class Search(
        val start: Long,
        val pieces: List<Piece?>,
        val slots: List<Int>,
        val startCombo: ComboState,
        val w: Weights,
    ) {
        // Лучшее набранное для (состояние → поле): одинаковые позиции разными путями не перебираем повторно.
        val seen = HashMap<Int, HashMap<Long, Double>>()
        val leaves = Array(4) { HashMap<Long, Leaf>() }
        var maxDepth = 0

        fun run(): Plan {
            rec(start, 0, 0, 0.0, startCombo.combo, startCombo.sinceClear, 0)
            val candidates = leaves[maxDepth].values
            if (maxDepth == 0 || candidates.isEmpty()) return Plan(emptyList(), false, 0)

            for (l in candidates) l.score = l.gained + cheapEval(l.board, w)
            val top = candidates.sortedByDescending { it.score }.take(TOP_K)
            for (l in top) l.score += fitEval(l.board, w)
            var ranked = top.sortedByDescending { it.score }
            if (w.lookahead > 0) {
                // Одни и те же будущие наборы для всех кандидатов — честное сравнение.
                val rnd = kotlin.random.Random(start xor 0x5DEECE66DL)
                val trays = List(w.lookaheadSamples) { List(3) { Pieces.ALL[rnd.nextInt(Pieces.ALL.size)] } }
                val head = ranked.take(w.lookaheadTop)
                for (l in head) l.score += w.lookahead * 100.0 * trays.count { canPlaceAll(l.board, it) } / trays.size
                ranked = head.sortedByDescending { it.score }
            }
            val best = ranked.first()
            return Plan(replay(best), maxDepth == slots.size, best.score.toInt())
        }

        fun rec(board: Long, used: Int, depth: Int, gained: Double, combo: Int, sinceClear: Int, path: Int) {
            val state = used or (sinceClear shl 3) or (minOf(combo, 31) shl 5)
            val map = seen.getOrPut(state) { HashMap() }
            val prev = map[board]
            if (prev != null && prev >= gained) return
            map[board] = gained

            var moved = false
            var tried0 = -1L; var tried1 = -1L
            for (s in slots) {
                if (used and (1 shl s) != 0) continue
                val p = pieces[s]!!
                if (p.mask == tried0 || p.mask == tried1) continue
                if (tried0 == -1L) tried0 = p.mask else tried1 = p.mask
                for (r in 0..Board.SIZE - p.height) for (c in 0..Board.SIZE - p.width) {
                    val pm = p.maskAt(r, c)
                    if (board and pm != 0L) continue
                    moved = true
                    val filled = board or pm
                    var clear = 0L
                    var lines = 0
                    for (i in 0 until Board.SIZE) {
                        if (filled and Board.ROWS[i] == Board.ROWS[i]) { clear = clear or Board.ROWS[i]; lines++ }
                        if (filled and Board.COLS[i] == Board.COLS[i]) { clear = clear or Board.COLS[i]; lines++ }
                    }
                    var g = gained
                    var nCombo = combo
                    var nSince = sinceClear
                    if (lines > 0) {
                        g += w.line * lines + w.multi * (lines - 1) * lines + w.combo * minOf(combo, 10)
                        nCombo = combo + 1
                        nSince = 0
                    } else {
                        nSince = sinceClear + 1
                        if (nSince >= 3) {
                            g -= w.comboLoss * minOf(combo, 10)
                            nCombo = 0
                        }
                    }
                    val code = (s shl 6) or (r shl 3) or c
                    rec(filled and clear.inv(), used or (1 shl s), depth + 1, g, nCombo, minOf(nSince, 3), path or (code shl (8 * depth)))
                }
            }
            if (!moved) {
                if (depth > maxDepth) maxDepth = depth
                val old = leaves[depth][board]
                if (old == null || old.gained < gained) leaves[depth][board] = Leaf(board, depth, gained, path)
            }
        }

        fun replay(leaf: Leaf): List<Move> {
            var b = start
            return (0 until leaf.depth).map { i ->
                val code = (leaf.path ushr (8 * i)) and 0xFF
                val slot = code ushr 6
                val r = (code ushr 3) and 7
                val c = code and 7
                val p = pieces[slot]!!
                val (next, lines) = Board.place(b, p.maskAt(r, c))
                b = next
                Move(slot, p, r, c, lines)
            }
        }
    }

    /** Можно ли поставить все фигуры в каком-нибудь порядке (с учётом очисток). */
    fun canPlaceAll(board: Long, pieces: List<Piece>): Boolean = placeRest(board, pieces, 0)

    private fun placeRest(board: Long, pieces: List<Piece>, used: Int): Boolean {
        if (used == (1 shl pieces.size) - 1) return true
        for (i in pieces.indices) {
            if (used and (1 shl i) != 0) continue
            val p = pieces[i]
            for (r in 0..Board.SIZE - p.height) for (c in 0..Board.SIZE - p.width) {
                val pm = p.maskAt(r, c)
                if (board and pm != 0L) continue
                if (placeRest(Board.place(board, pm).first, pieces, used or (1 shl i))) return true
            }
        }
        return false
    }

    /** Быстрая оценка поля: свободное место, «рваность» (стены считаются занятыми), дыры, место под крупные фигуры. */
    fun cheapEval(board: Long, w: Weights = Weights()): Double {
        val e = board.inv()
        val empties = java.lang.Long.bitCount(e)

        val nb = ((e ushr 1) and NOT_COL7) or ((e shl 1) and NOT_COL0) or (e shl 8) or (e ushr 8)
        val isolated = java.lang.Long.bitCount(e and nb.inv())

        val trans = java.lang.Long.bitCount((board xor (board ushr 1)) and NOT_COL7) +
            java.lang.Long.bitCount((board xor (board ushr 8)) and NOT_ROW7) +
            java.lang.Long.bitCount(e and COL0) + java.lang.Long.bitCount(e and COL7) +
            java.lang.Long.bitCount(e and ROW0) + java.lang.Long.bitCount(e and ROW7)

        val h2 = e and (e ushr 1) and NOT_COL7
        val sq2 = h2 and (h2 ushr 8)
        val h3 = h2 and (e ushr 2) and (NOT_COL7 and (NOT_COL7 ushr 1))
        val sq3 = h3 and (h3 ushr 8) and (h3 ushr 16)
        val h5 = e and (e ushr 1) and (e ushr 2) and (e ushr 3) and (e ushr 4) and COLS_0_3
        val v5 = e and (e ushr 8) and (e ushr 16) and (e ushr 24) and (e ushr 32)

        var score = empties * w.empty - trans * w.transition - isolated * w.isolated
        if (sq2 == 0L) score -= w.noSquare2
        if (sq3 == 0L) score -= w.noSquare3
        if (h5 == 0L) score -= w.noLine5
        if (v5 == 0L) score -= w.noLine5
        return score
    }

    /** Точная оценка: какая доля набора фигур (с весом по размеру) ещё помещается и сколько у них вариантов. */
    fun fitEval(board: Long, w: Weights = Weights()): Double {
        var lost = 0.0
        var free = 0
        var total = 0
        for (i in Pieces.ALL.indices) {
            var fits = false
            for (m in Pieces.PLACEMENTS[i]) {
                if (board and m == 0L) { fits = true; free++ }
            }
            total += Pieces.PLACEMENTS[i].size
            if (!fits) lost += Pieces.WEIGHTS[i]
        }
        return -w.fitLoss * 100 * lost / Pieces.TOTAL_WEIGHT + w.mobility * 100 * free / total
    }

    private val COLS_0_3 = Board.COLS[0] or Board.COLS[1] or Board.COLS[2] or Board.COLS[3]
}

package com.tuoverlays.bbhelper.core

/** Набор фигур Block Blast (все повороты и отражения). Нужен для оценки «что ещё влезет» и симулятора. */
object Pieces {

    private val BASE = listOf(
        listOf("#"),
        listOf("##"),
        listOf("###"),
        listOf("####"),
        listOf("#####"),
        listOf("##", "##"),
        listOf("###", "###", "###"),
        listOf("###", "###"),
        listOf("#.", "##"), // малый уголок
        listOf("#..", "#..", "###"), // большой уголок
        listOf("#.", "#.", "##"), // L
        listOf("###", ".#."), // T
        listOf(".##", "##."), // S
    )

    val ALL: List<Piece> = BASE.flatMap { variants(Piece.parse(*it.toTypedArray())) }.distinct()

    /** Все допустимые положения каждой фигуры набора на пустом поле 8×8. */
    val PLACEMENTS: Array<LongArray> = ALL.map { p ->
        val list = ArrayList<Long>()
        for (r in 0..Board.SIZE - p.height) for (c in 0..Board.SIZE - p.width) list += p.maskAt(r, c)
        list.toLongArray()
    }.toTypedArray()

    /** Вес фигуры в оценке: крупные фигуры опаснее, их потеря места важнее. */
    val WEIGHTS: DoubleArray = ALL.map { val n = it.cells.size.toDouble(); n * n }.toDoubleArray()
    val TOTAL_WEIGHT = WEIGHTS.sum()

    private fun variants(p: Piece): List<Piece> {
        val out = ArrayList<Piece>()
        var cells = p.cells
        repeat(4) {
            cells = cells.map { Cell(it.col, -it.row) } // поворот на 90°
            out += Piece.of(cells)!!
            out += Piece.of(cells.map { Cell(it.row, -it.col) })!! // отражение
        }
        return out.distinct()
    }
}

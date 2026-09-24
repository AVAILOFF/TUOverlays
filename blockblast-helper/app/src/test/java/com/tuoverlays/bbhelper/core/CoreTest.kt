package com.tuoverlays.bbhelper.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SolverTest {

    @Test
    fun placeClearsRowAndColumn() {
        val board = Board.parse(
            "#######.",
            ".......#",
            ".......#",
            ".......#",
            ".......#",
            ".......#",
            ".......#",
            ".......#",
        )
        val (next, lines) = Board.place(board, Board.bit(0, 7))
        assertEquals(2, lines)
        assertEquals(0L, next)
    }

    @Test
    fun prefersClearingLine() {
        val board = Board.parse(
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "#####...",
        )
        val plan = Solver.solve(board, listOf(Piece.parse("###"), null, null))!!
        assertEquals(1, plan.moves.size)
        val m = plan.moves[0]
        assertEquals(7, m.row)
        assertEquals(5, m.col)
        assertEquals(1, m.lines)
    }

    @Test
    fun placesAllPiecesWhenOrderMatters() {
        // Большой квадрат влезает только после того, как 1×4 очистит нижнюю строку.
        val board = Board.parse(
            "####.###",
            "####.###",
            "####.###",
            "####.###",
            "####.###",
            "########",
            "########",
            "####....",
        )
        val plan = Solver.solve(board, listOf(Piece.parse("###", "###", "###"), Piece.parse("####"), null))!!
        assertTrue(plan.placedAll)
        assertEquals(1, plan.moves.first().slot)
    }

    @Test
    fun reportsWhenNothingFits() {
        val board = Board.parse(
            "#.#.#.#.", ".#.#.#.#", "#.#.#.#.", ".#.#.#.#",
            "#.#.#.#.", ".#.#.#.#", "#.#.#.#.", ".#.#.#.#",
        )
        val plan = Solver.solve(board, listOf(Piece.parse("##"), null, null))!!
        assertTrue(plan.moves.isEmpty())
    }

    @Test
    fun fullSearchIsFast() {
        val pieces = listOf(Piece.parse("#"), Piece.parse("##"), Piece.parse("#", "#"))
        val t = System.nanoTime()
        Solver.solve(0L, pieces)
        val ms = (System.nanoTime() - t) / 1_000_000
        assertTrue("took $ms ms", ms < 3000)
    }
}

class VisionTest {

    private class Canvas(override val width: Int, override val height: Int, bg: Int) : PixelSource {
        val px = IntArray(width * height) { bg }
        override fun rgb(x: Int, y: Int) = px[y * width + x]
        fun fill(l: Int, t: Int, r: Int, b: Int, c: Int) {
            for (y in t until b) for (x in l until r) px[y * width + x] = c
        }
    }

    private val bgColor = 0x3C5AA8
    private val emptyCell = 0x1E2850
    private val colors = intArrayOf(0xE84A4A, 0x4AD65C, 0xF2C53D, 0x9B59D6)

    /** Рисует похожий на Block Blast кадр: поле 8×8 и три фигуры в лотке (клетки с тёмной окантовкой). */
    private fun render(board: Long, pieces: List<Piece?>): Canvas {
        val cv = Canvas(1080, 2000, bgColor)
        val cell = 120
        val bx = 60; val by = 300
        for (r in 0 until 8) for (c in 0 until 8) {
            val x = bx + c * cell; val y = by + r * cell
            cv.fill(x, y, x + cell, y + cell, 0x151C3A)
            val color = if (Board.isSet(board, r, c)) colors[(r + c) % colors.size] else emptyCell
            cv.fill(x + 3, y + 3, x + cell - 3, y + cell - 3, color)
        }
        val unit = 64
        val trayTop = by + 8 * cell + 40
        val slotW = 1080 / 3
        pieces.forEachIndexed { i, p ->
            p ?: return@forEachIndexed
            val ox = i * slotW + (slotW - p.width * unit) / 2
            val oy = trayTop + (400 - p.height * unit) / 2
            for (cl in p.cells) {
                val x = ox + cl.col * unit; val y = oy + cl.row * unit
                cv.fill(x, y, x + unit, y + unit, 0x8A2B2B)
                cv.fill(x + 4, y + 4, x + unit - 4, y + unit - 4, colors[i])
            }
        }
        return cv
    }

    @Test
    fun readsBoardAndPieces() {
        val board = Board.parse(
            "........",
            "..##....",
            "........",
            "#######.",
            "........",
            "...#....",
            "...#....",
            "##...###",
        )
        val pieces = listOf(Piece.parse("###", "#.."), null, Piece.parse("##", "##"))
        val cv = render(board, pieces)
        val snap = Vision.read(cv, Box(60f, 300f, 1020f, 1260f), Box(0f, 1300f, 1080f, 1700f))
        assertEquals(Board.toString(board), Board.toString(snap.board))
        assertEquals(pieces[0], snap.pieces[0])
        assertNull(snap.pieces[1])
        assertEquals(pieces[2], snap.pieces[2])
    }

    @Test
    fun readsLinesAndSingles() {
        val pieces = listOf(Piece.parse("#####"), Piece.parse("#"), Piece.parse("#", "#", "#"))
        val cv = render(0L, pieces)
        val snap = Vision.read(cv, Box(60f, 300f, 1020f, 1260f), Box(0f, 1300f, 1080f, 1700f))
        assertEquals(0L, snap.board)
        for (i in 0 until 3) {
            assertNotNull(snap.pieces[i])
            assertEquals(pieces[i], snap.pieces[i])
        }
    }
}

class TrayScaleTest {

    private fun dims(unit: Float, vararg pieces: Piece) = pieces.flatMap { listOf(it.width * unit, it.height * unit) }

    @Test
    fun learnsScaleWhenOddPieceAppears() {
        val unit = 0.55f
        val scale = TrayScale()
        val sq = Piece.parse("##", "##")
        // Только чётные стороны: по одному кадру удвоенный масштаб неотличим.
        scale.update(dims(unit, sq, sq, Piece.parse("####", "####")))
        // Появилась фигура 1×3 — теперь масштаб однозначен.
        assertEquals(unit, scale.update(dims(unit, Piece.parse("###"), sq, sq)), 0.01f)
        // И дальше квадраты читаются правильно.
        assertEquals(unit, scale.update(dims(unit, sq, sq, sq)), 0.01f)
    }

    @Test
    fun usesSavedScale() {
        val scale = TrayScale(saved = 0.5f)
        val sq = Piece.parse("##", "##")
        assertEquals(0.5f, scale.update(dims(0.5f, sq, sq, sq)), 0.01f)
    }

    @Test
    fun ignoresNoise() {
        val unit = 0.6f
        val scale = TrayScale()
        scale.update(dims(unit, Piece.parse("#"), Piece.parse("###"), Piece.parse("##", "##")))
        // Кадр анимации: размеры не кратны ничему разумному.
        scale.update(listOf(0.83f, 0.47f, 2.9f, 1.37f))
        assertEquals(unit, scale.update(dims(unit, Piece.parse("##", "##"), Piece.parse("##"), Piece.parse("####"))), 0.01f)
    }
}

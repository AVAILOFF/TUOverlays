package com.tuoverlays.bbhelper.core

import kotlin.random.Random

/**
 * Упрощённая модель Block Blast для проверки и подбора логики самоигрой:
 * каждый ход — 3 случайные фигуры из набора, игра кончается, когда все три поставить нельзя.
 * Очки: 1 за клетку, за очистку 10 × линии × линии × (1 + комбо).
 */
class Simulator(private val weights: Weights = Weights(), seed: Long = 1) {

    data class Result(val turns: Int, val score: Long, val maxCombo: Int)

    private val rnd = Random(seed)

    fun play(maxTurns: Int = Int.MAX_VALUE): Result {
        var board = 0L
        var combo = ComboState()
        var score = 0L
        var maxCombo = 0
        var turns = 0
        while (turns < maxTurns) {
            val tray = List(3) { Pieces.ALL[rnd.nextInt(Pieces.ALL.size)] }
            val plan = Solver.solve(board, tray, combo, weights) ?: break
            for (m in plan.moves) {
                val (next, lines) = Board.place(board, m.piece.maskAt(m.row, m.col))
                board = next
                score += m.piece.cells.size
                combo = if (lines > 0) {
                    score += 10L * lines * lines * (1 + combo.combo)
                    ComboState(combo.combo + 1, 0)
                } else {
                    val since = combo.sinceClear + 1
                    if (since >= 3) ComboState(0, 3) else ComboState(combo.combo, since)
                }
                if (combo.combo > maxCombo) maxCombo = combo.combo
            }
            if (!plan.placedAll) break
            turns++
        }
        return Result(turns, score, maxCombo)
    }
}

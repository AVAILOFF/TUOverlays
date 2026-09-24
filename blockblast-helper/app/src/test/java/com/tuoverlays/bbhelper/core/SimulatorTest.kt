package com.tuoverlays.bbhelper.core

import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class SimulatorTest {

    @Test
    fun pieceSetIsComplete() {
        // 1 + 2 + 2 + 2 + 2 + 1 + 1 + 2 + 4 + 4 + 8 + 4 + 4
        assertTrue("got ${Pieces.ALL.size}", Pieces.ALL.size == 37)
    }

    @Test
    fun survivesOpening() {
        val r = Simulator(seed = 7).play(maxTurns = 30)
        assertTrue("died at turn ${r.turns}", r.turns == 30)
    }

    /** Долгий прогон: gradle test -Dbbsim=games,maxTurns — средняя «живучесть» логики. */
    @Test
    fun benchmark() {
        val arg = System.getProperty("bbsim") ?: ""
        assumeTrue(arg.isNotEmpty())
        val (games, maxTurns) = arg.split(",").map { it.toInt() }
        val results = (1..games).map { Simulator(seed = it.toLong()).play(maxTurns) }
        results.forEachIndexed { i, r -> println("game ${i + 1}: turns=${r.turns} score=${r.score} maxCombo=${r.maxCombo}") }
        println("avg turns=${results.map { it.turns }.average()} min=${results.minOf { it.turns }} capped=${results.count { it.turns == maxTurns }}")
    }
}

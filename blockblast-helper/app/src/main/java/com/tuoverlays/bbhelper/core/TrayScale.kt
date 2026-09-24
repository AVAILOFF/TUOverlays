package com.tuoverlays.bbhelper.core

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Размер клетки фигур в лотке относительно клетки поля (ratio) в игре постоянный,
 * но по одному кадру его не угадать: квадрат 2×2 одинаково похож на 2×2 и на 1×1 вдвое крупнее.
 * Поэтому копим наблюдения по разным наборам фигур: верный масштаб согласуется со всеми,
 * а удвоенный отваливается, как только в лотке появится фигура с нечётной стороной.
 */
class TrayScale(saved: Float? = null) {

    var ratio: Float? = saved
        private set

    private val misses = FloatArray(BINS)
    private val errs = FloatArray(BINS)
    private var observations = 0
    private var lastDims: List<Float> = emptyList()

    init {
        // Сохранённый с прошлого запуска масштаб — как одно наблюдение, чтобы не угадывать заново.
        if (saved != null) {
            observations = 1
            for (i in 0 until BINS) if (abs(binRatio(i) - saved) > 0.01f) misses[i] = 1f
        }
    }

    /** dims — стороны найденных в лотке фигур в клетках поля. Возвращает масштаб для этого кадра. */
    fun update(dims: List<Float>): Float {
        if (dims.isNotEmpty() && !sameAsLast(dims)) {
            lastDims = dims
            val consistent = BooleanArray(BINS)
            var any = false
            for (i in 0 until BINS) {
                val e = fit(dims, binRatio(i))
                if (e != null) { consistent[i] = true; any = true; errs[i] += e }
            }
            // Кадр, где ни один масштаб не подходит, — анимация появления фигур: пропускаем.
            if (any) {
                observations++
                for (i in 0 until BINS) if (!consistent[i]) misses[i] += 1f
                ratio = pick() ?: ratio
            }
        }
        return ratio ?: bestFor(dims)
    }

    fun reset() {
        misses.fill(0f); errs.fill(0f); observations = 0; lastDims = emptyList(); ratio = null
    }

    /** Самый крупный масштаб, который не согласуется не более чем с 15% наблюдений. */
    private fun pick(): Float? {
        val allowed = observations * 0.15f
        var i = BINS - 1
        while (i >= 0 && misses[i] > allowed) i--
        if (i < 0) return null
        // В найденной группе соседних подходящих значений берём самое точное.
        var best = i
        var j = i
        while (j >= 0 && misses[j] <= allowed) {
            if (score(j) < score(best)) best = j
            j--
        }
        return binRatio(best)
    }

    private fun score(i: Int) = errs[i] + misses[i] * 10f

    private fun bestFor(dims: List<Float>): Float {
        for (i in BINS - 1 downTo 0) if (fit(dims, binRatio(i)) != null) {
            var best = i
            var j = i
            while (j >= 0 && fit(dims, binRatio(j)) != null) {
                if (fit(dims, binRatio(j))!! < fit(dims, binRatio(best))!!) best = j
                j--
            }
            return binRatio(best)
        }
        return 0.6f
    }

    private fun sameAsLast(dims: List<Float>): Boolean =
        dims.size == lastDims.size && dims.indices.all { abs(dims[it] - lastDims[it]) < 0.05f }

    companion object {
        const val MIN = 0.3f
        const val MAX = 1.1f
        private const val STEP = 0.005f
        private val BINS = ((MAX - MIN) / STEP).roundToInt() + 1
        private const val TOLERANCE = 0.15f

        private fun binRatio(i: Int) = MIN + i * STEP

        /** Сумма квадратов отклонений от целого числа клеток или null, если масштаб не подходит. */
        fun fit(dims: List<Float>, r: Float): Float? {
            var err = 0f
            for (d in dims) {
                val n = d / r
                val k = n.roundToInt()
                if (k < 1 || k > 5 || abs(n - k) > TOLERANCE) return null
                err += (n - k) * (n - k)
            }
            return err
        }
    }
}

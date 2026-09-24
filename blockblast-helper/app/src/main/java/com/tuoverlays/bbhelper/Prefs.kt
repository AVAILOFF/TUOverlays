package com.tuoverlays.bbhelper

import android.content.Context
import com.tuoverlays.bbhelper.core.Box

/** Сохранённая разметка: где на экране поле и лоток с фигурами (в пикселях экрана). */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("bbhelper", Context.MODE_PRIVATE)

    var board: Box?
        get() = readBox("board")
        set(v) = writeBox("board", v)

    var tray: Box?
        get() = readBox("tray")
        set(v) = writeBox("tray", v)

    /** Выученный масштаб фигур в лотке относительно клетки поля. */
    var trayRatio: Float?
        get() = if (sp.contains("trayRatio")) sp.getFloat("trayRatio", 0f) else null
        set(v) = sp.edit().apply { if (v == null) remove("trayRatio") else putFloat("trayRatio", v) }.apply()

    var bubbleX: Int
        get() = sp.getInt("bubbleX", 0)
        set(v) = sp.edit().putInt("bubbleX", v).apply()

    var bubbleY: Int
        get() = sp.getInt("bubbleY", 300)
        set(v) = sp.edit().putInt("bubbleY", v).apply()

    private fun readBox(key: String): Box? {
        if (!sp.contains("$key.l")) return null
        return Box(sp.getFloat("$key.l", 0f), sp.getFloat("$key.t", 0f), sp.getFloat("$key.r", 0f), sp.getFloat("$key.b", 0f))
    }

    private fun writeBox(key: String, b: Box?) {
        val e = sp.edit()
        if (b == null) {
            listOf("l", "t", "r", "b").forEach { e.remove("$key.$it") }
        } else {
            e.putFloat("$key.l", b.left).putFloat("$key.t", b.top).putFloat("$key.r", b.right).putFloat("$key.b", b.bottom)
        }
        e.apply()
    }

    companion object {
        /** Разметка по умолчанию под типичный портретный экран Block Blast. */
        fun defaultBoard(w: Int, h: Int): Box {
            val size = w * 0.9f
            val left = (w - size) / 2
            val top = h * 0.27f
            return Box(left, top, left + size, top + size)
        }

        fun defaultTray(board: Box, w: Int): Box {
            val top = board.bottom + board.height * 0.08f
            return Box(0f, top, w.toFloat(), top + board.height * 0.45f)
        }
    }
}

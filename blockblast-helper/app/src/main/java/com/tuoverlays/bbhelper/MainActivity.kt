package com.tuoverlays.bbhelper

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val d = resources.displayMetrics.density
        val pad = (20 * d).toInt()

        status = TextView(this).apply { textSize = 15f }
        val info = TextView(this).apply {
            textSize = 14f
            text = """
                Как пользоваться:
                1. Разрешите показ поверх других приложений.
                2. Нажмите «Запустить» и разрешите запись экрана («Весь экран»).
                3. Откройте Block Blast. В первый раз появится разметка: совместите зелёную рамку с полем 8×8, оранжевую — с тремя фигурами внизу, нажмите «Сохранить».
                4. На поле появятся контуры: 1 — какую фигуру ставить первой и куда, 2 и 3 — следующие (пунктир).

                Кнопка «BB»: нажать — вкл/выкл подсказки, удерживать — снова разметка, тащить — переместить (не держите её над полем).
            """.trimIndent()
        }
        val overlayBtn = Button(this).apply {
            text = "Разрешить поверх окон"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
        }
        val startBtn = Button(this).apply { text = "Запустить"; setOnClickListener { start() } }
        val stopBtn = Button(this).apply {
            text = "Остановить"
            setOnClickListener {
                startService(Intent(this@MainActivity, HelperService::class.java).setAction(HelperService.ACTION_STOP))
                status.postDelayed({ refresh() }, 300)
            }
        }
        val resetBtn = Button(this).apply {
            text = "Сбросить разметку"
            setOnClickListener {
                Prefs(this@MainActivity).apply { board = null; tray = null }
                Toast.makeText(this@MainActivity, "Разметка сброшена", Toast.LENGTH_SHORT).show()
            }
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad, pad * 2, pad, pad)
            addView(TextView(context).apply { text = "Block Blast Helper"; textSize = 22f })
            addView(status)
            addView(overlayBtn); addView(startBtn); addView(stopBtn); addView(resetBtn)
            addView(info)
        })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val overlay = Settings.canDrawOverlays(this)
        status.text = buildString {
            append(if (overlay) "✓ Показ поверх окон разрешён\n" else "✗ Нужно разрешить показ поверх окон\n")
            append(if (HelperService.running) "✓ Помощник работает" else "Помощник остановлен")
        }
    }

    private fun start() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Сначала разрешите показ поверх окон", Toast.LENGTH_LONG).show()
            return
        }
        if (HelperService.running) {
            Toast.makeText(this, "Уже работает", Toast.LENGTH_SHORT).show()
            return
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode == RESULT_OK && data != null) {
            HelperService.start(this, resultCode, data)
            Toast.makeText(this, "Открывайте Block Blast", Toast.LENGTH_SHORT).show()
            moveTaskToBack(true)
        } else {
            Toast.makeText(this, "Без записи экрана помощник не видит игру", Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        private const val REQ_CAPTURE = 1
    }
}

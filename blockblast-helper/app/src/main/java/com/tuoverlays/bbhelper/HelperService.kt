package com.tuoverlays.bbhelper

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.tuoverlays.bbhelper.core.Box
import com.tuoverlays.bbhelper.core.PixelSource
import com.tuoverlays.bbhelper.core.Snapshot
import com.tuoverlays.bbhelper.core.Solver
import com.tuoverlays.bbhelper.core.Vision
import java.nio.ByteBuffer
import kotlin.math.abs

/**
 * Захватывает экран, распознаёт поле и фигуры, считает лучший ход и рисует подсказки поверх игры.
 */
class HelperService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var worker: HandlerThread? = null
    private var workerHandler: Handler? = null

    private var hints: HintOverlayView? = null
    private var bubble: TextView? = null
    private var calibration: View? = null

    private var screen = Point()
    @Volatile private var board: Box? = null
    @Volatile private var tray: Box? = null
    @Volatile private var paused = false
    @Volatile private var enabled = true

    // Трогаются только из потока worker.
    private var lastSnapshot: Snapshot? = null
    private var solvedSnapshot: Snapshot? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_CALIBRATE) {
            if (projection != null) main.post { openCalibration() }
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY

        startForegroundCompat()

        val code = intent?.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        if (code != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = mpm.getMediaProjection(code, data) ?: run { stopSelf(); return START_NOT_STICKY }
        projection = mp

        val thread = HandlerThread("bb-capture").also { it.start() }
        worker = thread
        workerHandler = Handler(thread.looper)

        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { main.post { stopSelf() } }
        }, main)

        screen = screenSize()
        val ir = ImageReader.newInstance(screen.x, screen.y, PixelFormat.RGBA_8888, 2)
        reader = ir
        display = mp.createVirtualDisplay(
            "bb-helper", screen.x, screen.y, resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, ir.surface, null, workerHandler,
        )

        board = prefs.board
        tray = prefs.tray
        addHints()
        addBubble()
        if (board == null || tray == null) openCalibration()

        workerHandler?.post(tick)
        running = true
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        workerHandler?.removeCallbacksAndMessages(null)
        listOfNotNull(hints, bubble, calibration).forEach { runCatching { wm.removeView(it) } }
        hints = null; bubble = null; calibration = null
        display?.release()
        reader?.close()
        projection?.stop()
        worker?.quitSafely()
        projection = null
        super.onDestroy()
    }

    // ---- захват и анализ ----

    private val tick = object : Runnable {
        override fun run() {
            try {
                step()
            } catch (t: Throwable) {
                android.util.Log.e(TAG, "analysis failed", t)
            }
            workerHandler?.postDelayed(this, INTERVAL_MS)
        }
    }

    private fun step() {
        val image = reader?.acquireLatestImage() ?: return
        try {
            val b = board
            val t = tray
            if (paused || !enabled || b == null || t == null) return
            val snap = Vision.read(ImageSource(image), b, t)

            // Ждём, пока картинка устоится (анимации, перетаскивание фигуры).
            val stable = snap == lastSnapshot
            lastSnapshot = snap
            if (snap != solvedSnapshot) {
                if (solvedSnapshot != null) { solvedSnapshot = null; main.post { hints?.clear() } }
            }
            if (!stable || snap == solvedSnapshot) return

            solvedSnapshot = snap
            if (!snap.hasPieces) { main.post { hints?.clear() }; return }
            val plan = Solver.solve(snap.board, snap.pieces)
            main.post { if (enabled) hints?.show(plan, b, t) }
        } finally {
            image.close()
        }
    }

    private class ImageSource(image: Image) : PixelSource {
        private val plane = image.planes[0]
        private val buf: ByteBuffer = plane.buffer
        private val rowStride = plane.rowStride
        private val pixelStride = plane.pixelStride
        override val width = image.width
        override val height = image.height
        override fun rgb(x: Int, y: Int): Int {
            val o = y * rowStride + x * pixelStride
            return ((buf.get(o).toInt() and 0xFF) shl 16) or
                ((buf.get(o + 1).toInt() and 0xFF) shl 8) or
                (buf.get(o + 2).toInt() and 0xFF)
        }
    }

    // ---- окна поверх игры ----

    private fun overlayParams(touchable: Boolean) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE),
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (!touchable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Иначе Android 12+ блокирует касания сквозь непрозрачный слой.
            alpha = 0.8f
        }
    }

    private fun addHints() {
        val v = HintOverlayView(this)
        wm.addView(v, overlayParams(touchable = false))
        hints = v
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun addBubble() {
        val d = resources.displayMetrics.density
        val size = (46 * d).toInt()
        val v = TextView(this).apply {
            text = "BB"
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 14f
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(BUBBLE_ON) }
        }
        val lp = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.bubbleX; y = prefs.bubbleY
        }

        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var downAt = 0L; var dragged = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y
                    downAt = SystemClock.uptimeMillis(); dragged = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (dragged || abs(dx) > 12 * d || abs(dy) > 12 * d) {
                        dragged = true
                        lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt()
                        wm.updateViewLayout(v, lp)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (dragged) {
                        prefs.bubbleX = lp.x; prefs.bubbleY = lp.y
                    } else if (SystemClock.uptimeMillis() - downAt > 600) {
                        openCalibration()
                    } else {
                        toggle()
                    }
                }
            }
            true
        }
        wm.addView(v, lp)
        bubble = v
    }

    private fun toggle() {
        enabled = !enabled
        (bubble?.background as? GradientDrawable)?.setColor(if (enabled) BUBBLE_ON else BUBBLE_OFF)
        if (enabled) resetState() else hints?.clear()
        Toast.makeText(this, if (enabled) "Подсказки включены" else "Подсказки выключены", Toast.LENGTH_SHORT).show()
    }

    private fun resetState() {
        workerHandler?.post { lastSnapshot = null; solvedSnapshot = null }
    }

    private fun openCalibration() {
        if (calibration != null) return
        paused = true
        hints?.clear()
        val b0 = board ?: Prefs.defaultBoard(screen.x, screen.y)
        val t0 = tray ?: Prefs.defaultTray(b0, screen.x)
        val view = CalibrationView(this, b0, t0)
        val d = resources.displayMetrics.density

        val hint = TextView(this).apply {
            text = "Совместите зелёную рамку с полем, оранжевую — с зоной трёх фигур.\nТянуть рамку — двигать, кружок — размер."
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 13f
            setBackgroundColor(0xAA000000.toInt())
            setPadding((12 * d).toInt(), (8 * d).toInt(), (12 * d).toInt(), (8 * d).toInt())
        }
        val save = Button(this).apply { text = "Сохранить" }
        val stop = Button(this).apply { text = "Выключить" }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(hint)
            addView(LinearLayout(context).apply {
                gravity = Gravity.CENTER
                addView(save); addView(stop)
            })
        }
        val root = FrameLayout(this).apply {
            addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(panel, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.CENTER_HORIZONTAL,
            ).apply { topMargin = (48 * d).toInt() })
        }

        save.setOnClickListener {
            board = view.board; tray = view.tray
            prefs.board = view.board; prefs.tray = view.tray
            closeCalibration()
        }
        stop.setOnClickListener { stopSelf() }

        wm.addView(root, overlayParams(touchable = true))
        calibration = root
    }

    private fun closeCalibration() {
        calibration?.let { runCatching { wm.removeView(it) } }
        calibration = null
        resetState()
        paused = false
    }

    // ---- служебное ----

    @Suppress("DEPRECATION")
    private fun screenSize(): Point =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.maximumWindowMetrics.bounds
            Point(b.width(), b.height())
        } else {
            Point().also { wm.defaultDisplay.getRealSize(it) }
        }

    private fun startForegroundCompat() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Помощник Block Blast", NotificationManager.IMPORTANCE_LOW))
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stopPi = PendingIntent.getService(this, 1, Intent(this, HelperService::class.java).setAction(ACTION_STOP), flags)
        val calPi = PendingIntent.getService(this, 2, Intent(this, HelperService::class.java).setAction(ACTION_CALIBRATE), flags)
        val openPi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Помощник Block Blast работает")
            .setContentText("Нажмите «BB», чтобы вкл/выкл подсказки, удерживайте — разметка")
            .setContentIntent(openPi)
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "Разметка", calPi).build())
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "Стоп", stopPi).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    companion object {
        private const val TAG = "BBHelper"
        private const val CHANNEL = "helper"
        private const val NOTIFICATION_ID = 1
        private const val INTERVAL_MS = 300L
        private const val BUBBLE_ON = 0xCC2E7D32.toInt()
        private const val BUBBLE_OFF = 0xCC616161.toInt()

        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        const val ACTION_STOP = "com.tuoverlays.bbhelper.STOP"
        const val ACTION_CALIBRATE = "com.tuoverlays.bbhelper.CALIBRATE"

        @Volatile var running = false

        fun start(context: Context, code: Int, data: Intent) {
            val i = Intent(context, HelperService::class.java).putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data)
            context.startForegroundService(i)
        }
    }
}

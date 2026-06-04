package com.seq.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * ShakeDetectionService
 *
 * Foreground service that detects shakes while the app is backgrounded or killed.
 *
 * Lifecycle (FIX ISSUE #1):
 *   1. Shake detected            → write PREFS_KEY_PENDING + timestamp
 *   2. Heads-up notification     → user has NOTIFICATION_TIMEOUT_MS to act
 *      ├─ User taps notification  → MainActivity opens, JS bridge consumes flag
 *      ├─ User taps "Cancel"      → PanicDismissReceiver clears flag
 *      ├─ User swipes away        → setDeleteIntent → PanicDismissReceiver clears flag
 *      └─ Timeout (no action)     → runOnTimeout clears flag (defensive cleanup)
 *
 * IMPORTANT: We do NOT call setFullScreenIntent() with the launch-Activity PI.
 * On Android 10+ that path will pull the activity to the front on a locked
 * device even when the user did not tap the notification.  Instead, the
 * heads-up is a passive prompt — only an explicit tap (setContentIntent) opens
 * the app.  Combined with the JS bridge's timestamp-based stale guard
 * (SeqPanicModule.checkAndConsumePanic), a shake that the user ignores
 * dies silently. The user can later unlock their phone without the app
 * being yanked to the foreground.
 */
class ShakeDetectionService : android.app.Service(), SensorEventListener {

    companion object {
        // ── Channels ────────────────────────────────────────────────────────────
        const val CHANNEL_ID_SILENT   = "seq_service_channel"   // silent — ongoing service notif
        const val CHANNEL_ID_PANIC    = "seq_panic_channel"     // high-importance — shake alert

        const val NOTIFICATION_ID_SERVICE = 1002  // persistent silent notif (keeps service alive)
        const val NOTIFICATION_ID_PANIC   = 1003  // heads-up panic prompt

        // ── SharedPrefs keys ────────────────────────────────────────────────────
        const val PREFS_NAME              = "seq_panic_prefs"
        const val PREFS_KEY_PENDING       = "panic_pending"
        const val PREFS_KEY_PENDING_TS    = "panic_pending_ts"  // NEW: timestamp of the flag
        const val PREFS_KEY_PANIC_ACTIVE  = "panic_active"

        // Stale window — if the JS bridge sees a pending flag older than this,
        // it discards it.  Prevents a stuck flag from yanking the app forward
        // hours after the user ignored the heads-up.
        const val PENDING_TTL_MS = 30_000L

        // ── Shake algorithm ─────────────────────────────────────────────────────
        private const val REQUIRED_SHAKES = 5
        private const val WINDOW_MS       = 3000L
        private const val DEBOUNCE_MS     = 300L
        private const val THRESHOLD_MS2   = 12.0f   // net m/s² above gravity
        private const val COOLDOWN_MS     = 8000L

        // Auto-dismiss the panic heads-up notification after this many ms
        private const val NOTIFICATION_TIMEOUT_MS = 5000L

        private const val TAG = "SeQ_ShakeSvc"
    }

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null

    private val shakeTimestamps = mutableListOf<Long>()
    private var lastShakeMs     = 0L
    private var lastTriggerMs   = 0L

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand — starting foreground")
        startForeground(NOTIFICATION_ID_SERVICE, buildServiceNotification())
        accelerometer?.let {
            sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?) = null

    override fun onDestroy() {
        super.onDestroy()
        sensorManager?.unregisterListener(this)
        Log.d(TAG, "Service destroyed")
    }

    // ── Sensor callbacks ───────────────────────────────────────────────────────

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun onSensorChanged(event: SensorEvent?) {
        event?.takeIf { it.sensor.type == Sensor.TYPE_ACCELEROMETER } ?: return

        val x = event.values[0]; val y = event.values[1]; val z = event.values[2]
        val netAcc = Math.sqrt((x*x + y*y + z*z).toDouble()).toFloat() - SensorManager.GRAVITY_EARTH

        if (netAcc < THRESHOLD_MS2) return

        val now = System.currentTimeMillis()
        if (now - lastTriggerMs < COOLDOWN_MS) return
        if (now - lastShakeMs   < DEBOUNCE_MS) return
        lastShakeMs = now

        shakeTimestamps.removeAll { now - it > WINDOW_MS }
        shakeTimestamps.add(now)

        Log.d(TAG, "Shake #${shakeTimestamps.size} (net=${String.format("%.1f", netAcc)} m/s²)")

        if (shakeTimestamps.size >= REQUIRED_SHAKES) {
            shakeTimestamps.clear()
            lastTriggerMs = now
            triggerPanic()
        }
    }

    // ── Panic trigger ──────────────────────────────────────────────────────────

    private fun triggerPanic() {
        // Skip if a panic is already active
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(PREFS_KEY_PANIC_ACTIVE, false)) {
            Log.d(TAG, "Panic already active — ignoring shake")
            return
        }

        Log.d(TAG, "PANIC TRIGGERED — writing prefs and posting heads-up notification")
        // FIX ISSUE #1: write BOTH the flag and the timestamp atomically.
        // The JS bridge uses the timestamp to discard stale flags.
        prefs.edit()
            .putBoolean(PREFS_KEY_PENDING, true)
            .putLong(PREFS_KEY_PENDING_TS, System.currentTimeMillis())
            .apply()

        postPanicNotification()
    }

    /**
     * Post a heads-up notification.
     *
     * FIX ISSUE #1:
     *  - `setDeleteIntent` fires PanicDismissReceiver when the user SWIPES AWAY
     *    the heads-up.  Previously the swipe path left the pending flag set,
     *    which caused the app to yank itself to the foreground on next unlock.
     *  - We deliberately do NOT use setFullScreenIntent() with the launch-PI.
     *    On Android 10+ the system can auto-deliver the full-screen intent to
     *    the activity when the device is locked and the heads-up is shown,
     *    which is what the user is seeing as "app stays in front after the
     *    panic was disarmed".  A regular heads-up is enough; the user opens
     *    the app explicitly by tapping it.
     *  - The 5-second timeout handler is a defensive backstop.
     */
    private fun postPanicNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // TAP intent — explicit user action opens the app and routes to panic-shake.
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            putExtra("seq_action", "panic")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val tapPi = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // CANCEL intent — explicit "Cancel" action clears the pending flag.
        val cancelIntent = Intent(this, PanicDismissReceiver::class.java).apply {
            action = PanicDismissReceiver.ACTION_DISMISS
        }
        val cancelPi = PendingIntent.getBroadcast(
            this, 0, cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // SWIPE-AWAY intent — fires when the user dismisses the heads-up
        // (without tapping the Cancel button).  Without this, the pending
        // flag remained set and the app was launched on next unlock.
        val deleteIntent = Intent(this, PanicDismissReceiver::class.java).apply {
            action = PanicDismissReceiver.ACTION_DELETE
        }
        val deletePi = PendingIntent.getBroadcast(
            this, 1, deleteIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID_PANIC)
            .setContentTitle("🚨 Emergency Detected")
            .setContentText("Tap to activate — swipe away to cancel")
            .setSmallIcon(R.drawable.notification_icon)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setTimeoutAfter(NOTIFICATION_TIMEOUT_MS)
            .setContentIntent(tapPi)
            .setDeleteIntent(deletePi)        // FIX: fires on swipe-away
            .addAction(0, "Cancel", cancelPi)
            // FIX: do NOT call setFullScreenIntent() with tapPi — that path
            // pulls the activity to the front on a locked device even when
            // the user did not tap the notification.
            .setVibrate(longArrayOf(0, 300, 100, 300))
            .build()

        nm.notify(NOTIFICATION_ID_PANIC, notification)

        // Defensive backstop: if for any reason neither the cancel nor the
        // delete intent fires (rare OEM quirks), the timeout still clears
        // the flag.  By this point the heads-up is gone from the shade.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            nm.cancel(NOTIFICATION_ID_PANIC)
            val p = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (p.getBoolean(PREFS_KEY_PENDING, false)) {
                val age = System.currentTimeMillis() -
                          p.getLong(PREFS_KEY_PENDING_TS, 0L)
                if (age >= PENDING_TTL_MS) {
                    Log.d(TAG, "Pending flag expired (age=${age}ms) — clearing")
                    clearPendingFlag(p)
                }
            }
        }, NOTIFICATION_TIMEOUT_MS)
    }

    /** Centralised cleanup so Cancel / Delete / Timeout all converge. */
    internal fun clearPendingFlag(prefs: android.content.SharedPreferences) {
        prefs.edit()
            .remove(PREFS_KEY_PENDING)
            .remove(PREFS_KEY_PENDING_TS)
            .apply()
    }

    // ── Notification channels ──────────────────────────────────────────────────

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // 1. Silent channel — for the persistent "service running" notification
        if (nm.getNotificationChannel(CHANNEL_ID_SILENT) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID_SILENT,
                    "Se-Q Background Service",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Shake detection running"
                    enableVibration(false)
                    setSound(null, null)
                    setShowBadge(false)
                }
            )
        }

        // 2. High-importance channel — for the shake-triggered heads-up alert
        if (nm.getNotificationChannel(CHANNEL_ID_PANIC) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID_PANIC,
                    "Se-Q Emergency Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Shake-triggered emergency prompts"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 300, 100, 300)
                    setBypassDnd(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }

    private fun buildServiceNotification() = NotificationCompat.Builder(this, CHANNEL_ID_SILENT)
        .setContentTitle("Se-Q")
        .setContentText("Protection active")
        .setSmallIcon(R.drawable.notification_icon)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setSilent(true)
        .setOngoing(true)
        .build()
}

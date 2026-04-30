package com.safeguard.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.telephony.SmsManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class ShakeDetectionService : Service(), SensorEventListener {

    companion object {
        const val TAG = "SeQ_ShakeService"
        const val PREFS_NAME = "seq_shake_prefs"
        const val PREFS_KEY_PENDING = "shake_panic_pending"
        const val PREFS_KEY_PANIC_ACTIVE = "panic_active_native"
        const val ACTION_CANCEL = "SEQ_CANCEL_PANIC"
        const val ACTION_DISMISS = "SEQ_DISMISS_PANIC"
        const val ACTION_CONFIRM_PANIC = "SEQ_CONFIRM_PANIC_ACTIVATION"

        private const val CHANNEL_SHIELD = "seq_shield_monitor"
        private const val CHANNEL_COUNTDOWN = "seq_panic_countdown"
        private const val CHANNEL_CRITICAL = "seq_critical_alert"
        private const val NOTIF_SHIELD_ID = 9010
        private const val NOTIF_COUNTDOWN_ID = 9011
        private const val NOTIF_CRITICAL_ID = 9012

        private const val SHAKE_THRESHOLD_G = 3.5f
        private const val REQUIRED_SHAKES = 5
        private const val SHAKE_WINDOW_MS = 2000L
        private const val SHAKE_DEBOUNCE_MS = 200L
        private const val COUNTDOWN_MS = 2000L
        private const val TRIGGER_COOLDOWN = 10000L
        private const val PENDING_PANIC_TIMEOUT_MS = 10000L
        private const val SMS_FALLBACK_DELAY_MS = 5000L
    }

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private val shakeTimestamps = mutableListOf<Long>()
    private var lastShakeMs = 0L
    private var lastTriggerMs = 0L
    private var countdownRunning = false
    private var pendingPanicTimeoutRunnable: Runnable? = null
    private var smsFallbackRunnable: Runnable? = null
    private var appLaunchConfirmed = false

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate — starting protection shield with 5-shake detection")

        createNotificationChannels()
        startForeground(NOTIF_SHIELD_ID, buildShieldNotification())

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SeQ::ShakeWakeLock").apply { acquire() }

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        accelerometer?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI)
            Log.d(TAG, "Accelerometer registered")
        } ?: Log.w(TAG, "No accelerometer found")
        
        clearStalePendingPanic()
        
        // Extension 3: Check DND bypass
        checkAndRequestDndBypass()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> cancelCountdown()
            ACTION_DISMISS -> dismissPendingPanic()
            ACTION_CONFIRM_PANIC -> confirmPanicActivation()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        sensorManager.unregisterListener(this)
        mainHandler.removeCallbacksAndMessages(null)
        pendingPanicTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        smsFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        wakeLock?.let { if (it.isHeld) it.release() }
        Log.d(TAG, "onDestroy — protection shield stopped")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── EXTENSION 3: Full DND Bypass Methods ─────────────────────────────────
    private fun canBypassDnd(): Boolean {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            notificationManager.isNotificationPolicyAccessGranted
        } else {
            true
        }
    }

    private fun checkAndRequestDndBypass() {
        if (!canBypassDnd()) {
            Log.d(TAG, "DND bypass not granted - will request when panic occurs")
        }
    }

    private fun requestDndBypassPermission() {
        if (!canBypassDnd()) {
            Log.d(TAG, "Requesting DND bypass permission")
            val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open DND settings: ${e.message}")
            }
        }
    }

    // ── EXTENSION 4: SMS Fallback Methods ────────────────────────────────────
    private fun canSendSms(): Boolean {
        return ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.SEND_SMS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun sendEmergencySms() {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val emergencyContacts = prefs.getStringSet("emergency_contacts", emptySet())
            val userPhone = prefs.getString("user_phone_number", "")
            val lastLat = prefs.getFloat("last_latitude", 0f)
            val lastLng = prefs.getFloat("last_longitude", 0f)
            
            val mapsLink = "https://maps.google.com/?q=$lastLat,$lastLng"
            val timestamp = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US)
                .format(java.util.Date())
            
            val message = """
🚨 EMERGENCY SOS - Se-Q App

I need immediate help!

📍 Location: $mapsLink
🕐 Time: $timestamp
📱 Phone: $userPhone

This is an automated emergency alert.
Please respond or send help immediately.
            """.trimIndent()
            
            var smsSent = false
            
            // Send to emergency contacts
            emergencyContacts?.forEach { contact ->
                if (sendSms(contact, message)) {
                    smsSent = true
                }
            }
            
            // Send to security team if configured
            val securityNumber = prefs.getString("security_team_number", "")
            if (!securityNumber.isNullOrEmpty()) {
                if (sendSms(securityNumber, message)) {
                    smsSent = true
                }
            }
            
            if (smsSent) {
                Log.d(TAG, "Emergency SMS sent successfully")
                showSmsConfirmation()
            } else {
                Log.w(TAG, "No SMS sent - no contacts configured or permission denied")
                showSmsPermissionRequest()
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send emergency SMS: ${e.message}")
        }
    }
    
    private fun sendSms(phoneNumber: String, message: String): Boolean {
        return try {
            if (canSendSms()) {
                val smsManager = SmsManager.getDefault()
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
                Log.d(TAG, "SMS sent directly to $phoneNumber")
                true
            } else {
                // Fallback: open SMS app for user to send manually
                val smsIntent = Intent(Intent.ACTION_SENDTO).apply {
                    data = Uri.parse("smsto:$phoneNumber")
                    putExtra("sms_body", message)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(smsIntent)
                Log.d(TAG, "Opened SMS app for $phoneNumber")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send SMS to $phoneNumber: ${e.message}")
            false
        }
    }
    
    private fun showSmsConfirmation() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val confirmNotif = NotificationCompat.Builder(this, CHANNEL_SHIELD)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("📱 Emergency SMS Sent")
            .setContentText("Your emergency contacts have been notified via SMS")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        nm.notify(NOTIF_SHIELD_ID + 2, confirmNotif)
    }
    
    private fun showSmsPermissionRequest() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val permissionNotif = NotificationCompat.Builder(this, CHANNEL_SHIELD)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("⚠️ SMS Permission Required")
            .setContentText("Grant SMS permission in settings to enable emergency SMS fallback")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        nm.notify(NOTIF_SHIELD_ID + 3, permissionNotif)
    }

    // Called by MainActivity to confirm panic was activated
    private fun confirmPanicActivation() {
        appLaunchConfirmed = true
        smsFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        smsFallbackRunnable = null
        Log.d(TAG, "Panic activation confirmed - SMS fallback cancelled")
    }

    // ── Existing Helper Methods ──────────────────────────────────────────────
    private fun isPanicAlreadyActive(): Boolean {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val isActive = prefs.getBoolean(PREFS_KEY_PANIC_ACTIVE, false)
            if (isActive) {
                Log.d(TAG, "Panic already active — ignoring shake")
            }
            return isActive
        } catch (e: Exception) {
            Log.e(TAG, "Error checking panic state: ${e.message}")
            return false
        }
    }
    
    private fun isPendingPanicStale(): Boolean {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pendingTimestamp = prefs.getLong("pending_panic_timestamp", 0)
            if (pendingTimestamp > 0) {
                val elapsed = System.currentTimeMillis() - pendingTimestamp
                if (elapsed > PENDING_PANIC_TIMEOUT_MS) {
                    Log.d(TAG, "Pending panic is stale (${elapsed}ms old) — clearing")
                    clearPendingPanic()
                    return true
                }
            }
            return false
        } catch (e: Exception) {
            return false
        }
    }
    
    private fun clearStalePendingPanic() {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val pending = prefs.getBoolean(PREFS_KEY_PENDING, false)
            val pendingTimestamp = prefs.getLong("pending_panic_timestamp", 0)
            
            if (pending && pendingTimestamp > 0) {
                val elapsed = System.currentTimeMillis() - pendingTimestamp
                if (elapsed > PENDING_PANIC_TIMEOUT_MS) {
                    Log.d(TAG, "Clearing stale pending panic (${elapsed}ms old)")
                    prefs.edit()
                        .remove(PREFS_KEY_PENDING)
                        .remove("pending_panic_timestamp")
                        .apply()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing stale pending panic: ${e.message}")
        }
    }
    
    private fun clearPendingPanic() {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .remove(PREFS_KEY_PENDING)
                .remove("pending_panic_timestamp")
                .apply()
            Log.d(TAG, "Pending panic cleared")
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing pending panic: ${e.message}")
        }
    }
    
    private fun dismissPendingPanic() {
        Log.d(TAG, "User dismissed panic notification — clearing pending flag")
        clearPendingPanic()
        
        pendingPanicTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        pendingPanicTimeoutRunnable = null
        smsFallbackRunnable?.let { mainHandler.removeCallbacks(it) }
        smsFallbackRunnable = null
        appLaunchConfirmed = false
        
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_CRITICAL_ID)
        
        val dismissNotification = NotificationCompat.Builder(this, CHANNEL_SHIELD)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("Panic Cancelled")
            .setContentText("Emergency activation has been cancelled")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        nm.notify(NOTIF_SHIELD_ID + 1, dismissNotification)
        
        mainHandler.postDelayed({
            nm.notify(NOTIF_SHIELD_ID, buildShieldNotification())
        }, 2000)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        if (countdownRunning) return

        val now = System.currentTimeMillis()
        
        if (isPanicAlreadyActive()) return
        if (isPendingPanicStale()) return
        if (now - lastTriggerMs < TRIGGER_COOLDOWN) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]

        val gForce = Math.sqrt((x * x + y * y + z * z).toDouble()).toFloat() / SensorManager.GRAVITY_EARTH

        if (gForce < SHAKE_THRESHOLD_G) return
        if (now - lastShakeMs < SHAKE_DEBOUNCE_MS) return
        
        lastShakeMs = now
        shakeTimestamps.removeAll { now - it > SHAKE_WINDOW_MS }
        shakeTimestamps.add(now)

        val shakeCount = shakeTimestamps.size
        
        Log.d(TAG, "Rigorous shake! gForce=${"%.2f".format(gForce)}g | Count: $shakeCount/$REQUIRED_SHAKES")

        if (shakeCount >= REQUIRED_SHAKES) {
            if (isPanicAlreadyActive()) {
                Log.d(TAG, "Panic became active during shake window — aborting")
                shakeTimestamps.clear()
                return
            }
            
            shakeTimestamps.clear()
            lastTriggerMs = now
            beginCountdown()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun beginCountdown() {
        countdownRunning = true
        Log.d(TAG, "5-shake pattern detected — countdown started")
        showCountdownNotification()

        mainHandler.postDelayed({
            if (countdownRunning) {
                if (isPanicAlreadyActive()) {
                    Log.d(TAG, "Panic became active during countdown — aborting")
                    countdownRunning = false
                    cancelCountdown()
                    return@postDelayed
                }
                countdownRunning = false
                firePanic()
            }
        }, COUNTDOWN_MS)
    }

    private fun cancelCountdown() {
        countdownRunning = false
        mainHandler.removeCallbacksAndMessages(null)
        Log.d(TAG, "Panic countdown cancelled by user")

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_COUNTDOWN_ID)
        nm.cancel(NOTIF_CRITICAL_ID)
        nm.notify(NOTIF_SHIELD_ID, buildShieldNotification())
    }

    private fun firePanic() {
        Log.d(TAG, "PANIC FIRED — writing flag and launching app")
        
        appLaunchConfirmed = false

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(PREFS_KEY_PENDING, true)
            .putLong("pending_panic_timestamp", System.currentTimeMillis())
            .apply()

        val packageName = this.packageName
        
        val fullScreenIntent = Intent(this, MainActivity::class.java).apply {
            putExtra("SEQ_ACTIVATE_PANIC", true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
            addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
        }

        val pendingIntent = PendingIntent.getActivity(
            this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val dismissIntent = Intent(this, ShakeDetectionService::class.java).apply {
            action = ACTION_DISMISS
        }
        val dismissPendingIntent = PendingIntent.getService(
            this, 1, dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // EXTENSION 3: Enhanced notification with full DND bypass
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Log.d(TAG, "Using full-screen intent notification with DND bypass")
            
            val criticalNotification = NotificationCompat.Builder(this, CHANNEL_CRITICAL)
                .setSmallIcon(R.drawable.ic_sos_notification)
                .setContentTitle("🚨 EMERGENCY PANIC READY")
                .setContentText("Tap to activate OR swipe to cancel (auto-cancels in 10 seconds)")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(pendingIntent, true)
                .setAutoCancel(true)
                .setDeleteIntent(dismissPendingIntent)
                .setVibrate(longArrayOf(0, 1000, 500, 1000, 500, 1000))
                .setSound(Settings.System.DEFAULT_ALARM_ALERT_URI)
                .build()
            
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_CRITICAL_ID, criticalNotification)
            Log.d(TAG, "Critical notification posted with full DND bypass")
            
            pendingPanicTimeoutRunnable = Runnable {
                Log.d(TAG, "Pending panic timeout reached — auto-cancelling")
                if (isPendingPanicStale()) {
                    dismissPendingPanic()
                }
                pendingPanicTimeoutRunnable = null
            }
            mainHandler.postDelayed(pendingPanicTimeoutRunnable!!, PENDING_PANIC_TIMEOUT_MS)
            
            // EXTENSION 4: SMS Fallback - if app doesn't confirm activation
            smsFallbackRunnable = Runnable {
                if (!appLaunchConfirmed) {
                    Log.w(TAG, "App not activated within ${SMS_FALLBACK_DELAY_MS}ms — sending SMS fallback")
                    sendEmergencySms()
                }
                smsFallbackRunnable = null
            }
            mainHandler.postDelayed(smsFallbackRunnable!!, SMS_FALLBACK_DELAY_MS)
            
        } else {
            Log.d(TAG, "Starting activity directly for older Android")
            try {
                startActivity(fullScreenIntent)
                appLaunchConfirmed = true
                Log.d(TAG, "MainActivity started directly")
            } catch (e: Exception) {
                Log.e(TAG, "Direct activity start failed: ${e.message}")
                try {
                    pendingIntent.send()
                    appLaunchConfirmed = true
                    Log.d(TAG, "Pending intent sent")
                } catch (e2: Exception) {
                    Log.e(TAG, "Pending intent also failed: ${e2.message}")
                    // EXTENSION 4: Immediate SMS fallback if app won't launch
                    sendEmergencySms()
                }
            }
        }

        val broadcastIntent = Intent("SEQ_PANIC_TRIGGERED").apply {
            putExtra("SEQ_ACTIVATE_PANIC", true)
            setPackage(packageName)
        }
        sendBroadcast(broadcastIntent)
        Log.d(TAG, "Broadcast sent")

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_COUNTDOWN_ID)
        nm.notify(NOTIF_SHIELD_ID, buildShieldNotification())
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SHIELD, "Se-Q Shield Monitor",
                NotificationManager.IMPORTANCE_LOW).apply {
                description = "5-shake emergency detection running"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
        )

        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_COUNTDOWN, "Se-Q Panic Countdown",
                NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Shows 2-second cancel window before panic fires"
                setSound(null, null)   // silent — vibration only
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 100, 300, 100, 300)
                lightColor = 0xFFEF4444.toInt()
                enableLights(true)
            }
        )

        // EXTENSION 3: Enhanced critical channel with full DND bypass
        val criticalChannel = NotificationChannel(CHANNEL_CRITICAL, "Se-Q Emergency Alert",
            NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Critical emergency alerts that bypass Do Not Disturb"
            setSound(null, null)   // silent — alarm sound removed
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
            lightColor = 0xFFEF4444.toInt()
            enableLights(true)
            setBypassDnd(true)  // KEY: Bypass Do Not Disturb
        }
        nm.createNotificationChannel(criticalChannel)
    }

    private fun buildShieldNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_SHIELD)
            .setSmallIcon(R.drawable.ic_sos_notification)
            .setContentTitle("🛡️ Se-Q Protection Active")
            .setContentText("Shake phone VIGOROUSLY 5 times to trigger emergency")
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(true)
            .setColor(0xFF10B981.toInt())
            .build()
    }

    private fun showCountdownNotification() {
        val cancelIntent = Intent(this, ShakeDetectionService::class.java).apply {
            action = ACTION_CANCEL
        }
        val cancelPi = PendingIntent.getService(
            this, 999, cancelIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(
            NOTIF_COUNTDOWN_ID,
            NotificationCompat.Builder(this, CHANNEL_COUNTDOWN)
                .setSmallIcon(R.drawable.ic_sos_notification)
                .setContentTitle("🚨 PANIC ACTIVATING IN 2 SECONDS")
                .setContentText("5 shakes detected! Tap Cancel if accidental")
                .addAction(R.drawable.ic_sos_notification, "✕ Cancel — False Alarm", cancelPi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOngoing(true)
                .setAutoCancel(false)
                .setColor(0xFFEF4444.toInt())
                .setVibrate(longArrayOf(0, 300, 100, 300))
                .build()
        )
    }
}

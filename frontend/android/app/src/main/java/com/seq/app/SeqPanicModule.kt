package com.seq.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class SeqPanicModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SeqPanicModule"
    }

    override fun getName(): String = "SeqPanic"

    // ── Check & consume the pending-panic flag written by ShakeDetectionService ─
    //
    // FIX ISSUE #1: The flag now carries a timestamp.  If the flag is older
    // than ShakeDetectionService.PENDING_TTL_MS we treat it as stale and
    // discard it WITHOUT bringing the app to the foreground.  This is the
    // belt-and-braces guard against a stuck flag — even if every other
    // dismissal path (Cancel, swipe-away, timeout) fails on a particular
    // OEM, the JS bridge will not pull the user into the panic flow for a
    // shake they ignored long ago.
    @ReactMethod
    fun checkAndConsumePanic(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME, Context.MODE_PRIVATE
            )
            val pending = prefs.getBoolean(ShakeDetectionService.PREFS_KEY_PENDING, false)
            if (!pending) {
                promise.resolve(false)
                return
            }

            val ts  = prefs.getLong(ShakeDetectionService.PREFS_KEY_PENDING_TS, 0L)
            val age = if (ts > 0) System.currentTimeMillis() - ts else Long.MAX_VALUE

            if (age > ShakeDetectionService.PENDING_TTL_MS) {
                Log.w(TAG, "Stale pending flag (age=${age}ms > TTL=${ShakeDetectionService.PENDING_TTL_MS}ms) — discarding")
                prefs.edit()
                    .remove(ShakeDetectionService.PREFS_KEY_PENDING)
                    .remove(ShakeDetectionService.PREFS_KEY_PENDING_TS)
                    .apply()
                promise.resolve(false)
                return
            }

            prefs.edit()
                .remove(ShakeDetectionService.PREFS_KEY_PENDING)
                .remove(ShakeDetectionService.PREFS_KEY_PENDING_TS)
                .apply()
            Log.d(TAG, "Consumed pending panic flag (age=${age}ms)")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "checkAndConsumePanic error: ${e.message}")
            promise.resolve(false)
        }
    }

    // ── JS-driven explicit cancel (e.g. user pressed "I'm OK" in the app) ──────
    @ReactMethod
    fun dismissPanic(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME, Context.MODE_PRIVATE
            )
            prefs.edit()
                .remove(ShakeDetectionService.PREFS_KEY_PENDING)
                .remove(ShakeDetectionService.PREFS_KEY_PENDING_TS)
                .apply()
            // Cancel the heads-up too — important when the user dismisses
            // from inside the app.
            val nm = reactApplicationContext
                .getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.cancel(ShakeDetectionService.NOTIFICATION_ID_PANIC)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "dismissPanic error: ${e.message}")
            promise.resolve(false)
        }
    }

    // ── Let JS tell the native service whether a panic is already active ───────
    @ReactMethod
    fun setPanicActive(active: Boolean, promise: Promise?) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME, Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(ShakeDetectionService.PREFS_KEY_PANIC_ACTIVE, active)
                .apply()
            Log.d(TAG, "setPanicActive: $active")
            promise?.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setPanicActive error: ${e.message}")
            promise?.resolve(false)
        }
    }

    // ── Start ShakeDetectionService ────────────────────────────────────────────
    @ReactMethod
    fun startShakeService(promise: Promise) {
        try {
            val ctx    = reactApplicationContext
            val intent = Intent(ctx, ShakeDetectionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            Log.d(TAG, "ShakeDetectionService started from JS")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "startShakeService error: ${e.message}")
            promise.resolve(false)
        }
    }

    // ── Stop ShakeDetectionService ─────────────────────────────────────────────
    // Called when a non-civil role logs in (admin / security).
    // Also clears any stale pending-panic flag so a previously running service
    // cannot leave ghost state that affects the next session.
    @ReactMethod
    fun stopShakeService(promise: Promise) {
        try {
            val ctx    = reactApplicationContext
            val intent = Intent(ctx, ShakeDetectionService::class.java)
            ctx.stopService(intent)

            ctx.getSharedPreferences(ShakeDetectionService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(ShakeDetectionService.PREFS_KEY_PENDING)
                .remove(ShakeDetectionService.PREFS_KEY_PENDING_TS)
                .apply()

            Log.d(TAG, "ShakeDetectionService stopped from JS")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "stopShakeService error: ${e.message}")
            promise.resolve(false)
        }
    }

    // ── Check if battery optimization is already disabled ─────────────────────
    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = reactApplicationContext
                    .getSystemService(Context.POWER_SERVICE) as PowerManager
                promise.resolve(pm.isIgnoringBatteryOptimizations(
                    reactApplicationContext.packageName
                ))
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "isIgnoringBatteryOptimizations error: ${e.message}")
            promise.resolve(false)
        }
    }

    // ── Open the battery optimization exemption dialog directly ───────────────
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${reactApplicationContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true) // Not needed below API 23
            }
        } catch (e: Exception) {
            // Fallback: open the general battery optimization settings list
            try {
                val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(fallback)
                promise.resolve(true)
            } catch (e2: Exception) {
                Log.e(TAG, "requestIgnoreBatteryOptimizations error: ${e2.message}")
                promise.resolve(false)
            }
        }
    }

    // ── Permission diagnostics (used by the JS-layer periodic check-up) ───────
    // Returns a JSON object so the JS layer can render a single "missing
    // permissions" banner with everything in one round-trip.
    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val map: WritableMap = Arguments.createMap()

            val fine     = ctx.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)     == android.content.pm.PackageManager.PERMISSION_GRANTED
            val coarse   = ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)   == android.content.pm.PackageManager.PERMISSION_GRANTED
            val bg       = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                ctx.checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
            else true
            val camera   = ctx.checkSelfPermission(android.Manifest.permission.CAMERA)                  == android.content.pm.PackageManager.PERMISSION_GRANTED
            val mic      = ctx.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)             == android.content.pm.PackageManager.PERMISSION_GRANTED
            val sms      = ctx.checkSelfPermission(android.Manifest.permission.SEND_SMS)                 == android.content.pm.PackageManager.PERMISSION_GRANTED
            val notif    = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
            else true
            val fullScrn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                ctx.checkSelfPermission(android.Manifest.permission.USE_FULL_SCREEN_INTENT) == android.content.pm.PackageManager.PERMISSION_GRANTED
            else true

            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            val batteryIgnored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                pm.isIgnoringBatteryOptimizations(ctx.packageName) else true

            map.putBoolean("location_fine",          fine)
            map.putBoolean("location_coarse",        coarse)
            map.putBoolean("location_background",    bg)
            map.putBoolean("camera",                 camera)
            map.putBoolean("microphone",             mic)
            map.putBoolean("sms",                    sms)
            map.putBoolean("notifications",          notif)
            map.putBoolean("full_screen_intent",     fullScrn)
            map.putBoolean("battery_optimization_off", batteryIgnored)
            promise.resolve(map)
        } catch (e: Exception) {
            Log.e(TAG, "getPermissionStatus error: ${e.message}")
            promise.resolve(null)
        }
    }
}

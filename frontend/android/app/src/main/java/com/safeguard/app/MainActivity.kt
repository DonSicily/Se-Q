package com.safeguard.app

import expo.modules.splashscreen.SplashScreenManager

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

    companion object {
        private const val TAG = "SeQ_MainActivity"
        private const val REQUEST_IGNORE_BATTERY_OPTIMIZATIONS = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        SplashScreenManager.registerOnActivity(this)
        super.onCreate(null)

        startShakeDetectionService()
        
        val panicTriggered = handlePanicIntentOnCreate(intent)
        
        if (!panicTriggered) {
            checkPendingPanicOnColdStart()
        }
        
        // EXTENSION 4: Confirm panic activation to cancel SMS fallback
        confirmPanicActivationToService()
        
        // ── BATTERY OPTIMIZATION EXEMPTION ─────────────────────────────────
        // This ensures the shake detection service stays alive even when 
        // the app is in the background and the device has battery optimization enabled
        checkAndRequestBatteryOptimizationExemption()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (handlePanicIntentOnCreate(intent)) {
            try {
                val prefs = getSharedPreferences(ShakeDetectionService.PREFS_NAME, MODE_PRIVATE)
                prefs.edit().putBoolean(ShakeDetectionService.PREFS_KEY_PENDING, true).apply()
                Log.d(TAG, "Pending panic flag set from onNewIntent")
            } catch (e: Exception) {
                Log.e(TAG, "Error setting pending flag: ${e.message}")
            }
        }
        // EXTENSION 4: Confirm on new intent as well
        confirmPanicActivationToService()
    }

    private fun startShakeDetectionService() {
        try {
            val shakeIntent = Intent(this, ShakeDetectionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(shakeIntent)
            } else {
                startService(shakeIntent)
            }
            Log.d(TAG, "ShakeDetectionService start requested")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start ShakeDetectionService: ${e.message}")
        }
    }

    private fun handlePanicIntentOnCreate(intent: Intent?): Boolean {
        if (intent?.getBooleanExtra("SEQ_ACTIVATE_PANIC", false) == true) {
            Log.d(TAG, "SEQ_ACTIVATE_PANIC intent received in onCreate")
            getSharedPreferences(ShakeDetectionService.PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putBoolean(ShakeDetectionService.PREFS_KEY_PENDING, true)
                .apply()
            return true
        }
        return false
    }
    
    private fun checkPendingPanicOnColdStart() {
        try {
            val prefs = getSharedPreferences(ShakeDetectionService.PREFS_NAME, MODE_PRIVATE)
            val pending = prefs.getBoolean(ShakeDetectionService.PREFS_KEY_PENDING, false)
            if (pending) {
                Log.d(TAG, "Pending panic found on cold start - keeping flag for JS")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking pending panic: ${e.message}")
        }
    }
    
    // EXTENSION 4: Confirm panic activation to cancel SMS fallback
    private fun confirmPanicActivationToService() {
        try {
            val confirmIntent = Intent("SEQ_CONFIRM_PANIC_ACTIVATION").apply {
                setPackage(packageName)
            }
            sendBroadcast(confirmIntent)
            Log.d(TAG, "Panic activation confirmation sent to service")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send confirmation: ${e.message}")
        }
    }
    
    // ── BATTERY OPTIMIZATION EXEMPTION ─────────────────────────────────────
    private fun checkAndRequestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val powerManager = getSystemService(POWER_SERVICE) as PowerManager
                
                if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                    Log.d(TAG, "Not exempt from battery optimizations - showing explanation dialog")
                    showBatteryOptimizationExplanation()
                } else {
                    Log.d(TAG, "Already exempted from battery optimizations")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to check battery optimization status: ${e.message}")
            }
        }
    }
    
    private fun showBatteryOptimizationExplanation() {
        AlertDialog.Builder(this)
            .setTitle("🔋 Keep Se-Q Always Ready")
            .setMessage("To ensure Se-Q can detect emergency shakes even when your phone is locked. Kindly note that this feature does NOT drain your battery - the app only activates during emergency shakes.")
            .setPositiveButton("Allow") { _, _ ->
                requestBatteryOptimizationExemption()
            }
            .setNegativeButton("Later") { _, _ ->
                Log.w(TAG, "User postponed battery optimization - service may be killed in background")
            }
            .setCancelable(false)
            .show()
    }
    
    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivityIfNeeded(intent, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                Log.d(TAG, "Battery optimization exemption requested")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request battery optimization exemption: ${e.message}")
            }
        }
    }
    
    // Handle the result of battery optimization request
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            val isExempted = powerManager.isIgnoringBatteryOptimizations(packageName)
            Log.d(TAG, "Battery optimization exemption result: $isExempted")
            if (!isExempted) {
                Log.w(TAG, "User did NOT grant battery optimization exemption - service may be killed in background")
                // Optional: Show a reminder later
            } else {
                Log.d(TAG, "User granted battery optimization exemption - service will run reliably")
            }
        }
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled
            ) {}
        )
    }

    override fun invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (!moveTaskToBack(false)) {
                super.invokeDefaultOnBackPressed()
            }
            return
        }
        super.invokeDefaultOnBackPressed()
    }
}

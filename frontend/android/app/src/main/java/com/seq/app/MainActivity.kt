package com.seq.app

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
        super.onCreate(savedInstanceState)
    }

    override fun onPostCreate(savedInstanceState: Bundle?) {
        super.onPostCreate(savedInstanceState)
        startShakeDetectionService()
        val panicTriggered = handlePanicIntentOnCreate(intent)
        if (!panicTriggered) {
            checkPendingPanicOnColdStart()
        }
        confirmPanicActivationToService()
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
            Log.d(TAG, "SEQ_ACTIVATE_PANIC intent received")
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
                Log.d(TAG, "Pending panic found on cold start")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking pending panic: ${e.message}")
        }
    }

    private fun confirmPanicActivationToService() {
        try {
            val confirmIntent = Intent("SEQ_CONFIRM_PANIC_ACTIVATION").apply {
                setPackage(packageName)
            }
            sendBroadcast(confirmIntent)
            Log.d(TAG, "Panic activation confirmation sent")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send confirmation: ${e.message}")
        }
    }

    private fun checkAndRequestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val powerManager = getSystemService(POWER_SERVICE) as PowerManager
                if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                    showBatteryOptimizationExplanation()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to check battery optimization: ${e.message}")
            }
        }
    }

    private fun showBatteryOptimizationExplanation() {
        AlertDialog.Builder(this)
            .setTitle("Keep Se-Q Always Ready")
            .setMessage("To ensure Se-Q can detect emergency shakes even when your phone is locked.")
            .setPositiveButton("Allow") { _, _ -> requestBatteryOptimizationExemption() }
            .setNegativeButton("Later") { _, _ -> Log.w(TAG, "User postponed") }
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
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request exemption: ${e.message}")
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            Log.d(TAG, "Battery optimization result: ${powerManager.isIgnoringBatteryOptimizations(packageName)}")
        }
    }

    override fun getMainComponentName(): String = "main"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {}
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

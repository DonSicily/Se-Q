package com.safeguard.app

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SeqPanicModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SeqPanic"

    @ReactMethod
    fun checkAndConsumePanic(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val pending = prefs.getBoolean(ShakeDetectionService.PREFS_KEY_PENDING, false)
            if (pending) {
                prefs.edit()
                    .remove(ShakeDetectionService.PREFS_KEY_PENDING)
                    .apply()
            }
            promise.resolve(pending)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun setPanicActive(active: Boolean, promise: Promise?) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(ShakeDetectionService.PREFS_KEY_PANIC_ACTIVE, active)
                .apply()
            
            android.util.Log.d("SeqPanicModule", "setPanicActive: $active")
            promise?.resolve(true)
        } catch (e: Exception) {
            android.util.Log.e("SeqPanicModule", "Error setting panic active: ${e.message}")
            promise?.resolve(false)
        }
    }
}

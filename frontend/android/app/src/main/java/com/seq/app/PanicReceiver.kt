package com.seq.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class PanicReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "SEQ_PANIC_TRIGGERED") {
            Log.d("PanicReceiver", "Panic triggered via broadcast")

            val prefs = context.getSharedPreferences(
                ShakeDetectionService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            // FIX ISSUE #1: write the timestamp alongside the flag so the
            // JS bridge (SeqPanicModule.checkAndConsumePanic) can treat
            // stuck flags as stale instead of bringing the app forward.
            prefs.edit()
                .putBoolean(ShakeDetectionService.PREFS_KEY_PENDING, true)
                .putLong(ShakeDetectionService.PREFS_KEY_PENDING_TS, System.currentTimeMillis())
                .apply()

            // Try to launch the app
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            launchIntent?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                it.putExtra("SEQ_ACTIVATE_PANIC", true)
                context.startActivity(it)
                Log.d("PanicReceiver", "App launched via broadcast")
            }
        }
    }
}

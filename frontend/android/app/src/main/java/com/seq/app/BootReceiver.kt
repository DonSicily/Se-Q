package com.seq.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * BootReceiver.kt
 *
 * Listens for BOOT_COMPLETED and QUICKBOOT_POWERON.
 * Starts BootRestartService to restore Se-Q protection after reboot.
 *
 * Registered in AndroidManifest.xml with priority 1000.
 * Requires RECEIVE_BOOT_COMPLETED permission.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SeQ_BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return

        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") return

        Log.d(TAG, "Boot completed — starting BootRestartService")

        try {
            val serviceIntent = Intent(context, BootRestartService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start BootRestartService: ${e.message}")
        }
    }
}

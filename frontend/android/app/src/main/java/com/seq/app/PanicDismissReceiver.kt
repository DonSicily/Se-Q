package com.seq.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * PanicDismissReceiver
 *
 * FIX ISSUE #1: handles THREE dismissal paths so the pending-panic flag is
 * cleared whichever way the user dismisses the heads-up notification.
 *  - ACTION_DISMISS  → user tapped the explicit "Cancel" action
 *  - ACTION_DELETE   → user swiped the heads-up away
 *  - (default)       → legacy / safety net
 *
 * The bug we are fixing:
 *   Shake → heads-up shown → user does NOT tap Cancel and does NOT tap the
 *   notification.  Heads-up times out / user swipes it.  The pending flag
 *   stayed set, so on the next unlock the JS bridge (checkAndConsumePanic)
 *   saw the flag, consumed it, and pulled the app to the foreground.
 *
 *   Now every dismissal path routes through this receiver and clears the
 *   flag.  The 5-second timeout handler in ShakeDetectionService is a
 *   defensive backstop only.
 */
class PanicDismissReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_DISMISS = "com.seq.app.PANIC_DISMISS"
        const val ACTION_DELETE  = "com.seq.app.PANIC_DELETE"
        private const val TAG = "SeQ_PanicDismiss"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: ACTION_DISMISS
        Log.d(TAG, "Dismissing panic — action=$action")

        val prefs = context.getSharedPreferences(
            ShakeDetectionService.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        // clearPendingFlag also removes the timestamp key, so the JS bridge
        // sees a coherent "no pending panic" state.
        prefs.edit()
            .remove(ShakeDetectionService.PREFS_KEY_PENDING)
            .remove(ShakeDetectionService.PREFS_KEY_PENDING_TS)
            .apply()

        // Cancel the notification in case it wasn't already auto-cancelled.
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE)
                as android.app.NotificationManager
        nm.cancel(ShakeDetectionService.NOTIFICATION_ID_PANIC)
    }
}

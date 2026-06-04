package com.seq.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

/**
 * MainActivity
 *
 * FIX ISSUE #1:
 *   When the user explicitly taps the shake heads-up notification, this
 *   activity launches.  We pass the seq_action=panic extra through
 *   handlePanicIntent() so the JS bridge can route to /civil/panic-shake
 *   when it next runs.
 *
 *   Critically, we DO NOT set the seq_action=panic extra for any other
 *   reason — the activity is no longer pulled to the front automatically
 *   on a heads-up.  The launch is now strictly user-initiated (explicit
 *   tap on the notification).
 */
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    handlePanicIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    intent?.let { handlePanicIntent(it) }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
   * If launched from the shake heads-up tap, reinforce the pending flag.
   * (The service wrote it before the activity started; this closes a small
   * race where the service could have been killed between the write and
   * the activity launch.)  The JS bridge will then consume it in _layout.tsx.
   */
  private fun handlePanicIntent(intent: Intent) {
    val seqAction = intent.getStringExtra("seq_action")
    if (seqAction == "panic") {
      Log.d("SeQ_MainActivity", "Launched from shake heads-up — reinforcing pending flag")
      val prefs = getSharedPreferences(ShakeDetectionService.PREFS_NAME, MODE_PRIVATE)
      prefs.edit()
          .putBoolean(ShakeDetectionService.PREFS_KEY_PENDING, true)
          .putLong(ShakeDetectionService.PREFS_KEY_PENDING_TS, System.currentTimeMillis())
          .apply()
    }
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}

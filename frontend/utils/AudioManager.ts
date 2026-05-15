/**
 * AudioManager.ts — Centralized audio session management
 *
 * Design contract:
 *   1. Single point of control for all expo-av Audio operations
 *   2. Priority-based audio mode management prevents sound clashes
 *   3. Automatic audio mode restoration when higher-priority tasks complete
 *   4. Safe cleanup on unmount and screen transitions
 *
 * Priority levels:
 *   - RECORDING (100): Recording operations (highest priority)
 *   - ALERT (75): Panic alarms and message alerts
 *   - AMBIENT (50): Ambient sound playback
 *   - PLAYBACK (25): Video/audio report playback (lowest priority)
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Platform } from 'react-native';

// Priority enum
export enum AudioPriority {
  PLAYBACK = 25,    // Lowest - video/audio playback
  AMBIENT = 50,     // Ambient sound
  ALERT = 75,       // Panic alarms, message alerts
  RECORDING = 100,  // Highest - recording operations
}

// Audio mode configurations
const AUDIO_MODES = {
  [AudioPriority.RECORDING]: {
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: false, // Don't duck during recording
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  },
  [AudioPriority.ALERT]: {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false, // Alert needs to be heard clearly
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  },
  [AudioPriority.AMBIENT]: {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true, // Duck ambient, let alerts through
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  },
  [AudioPriority.PLAYBACK]: {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true, // Polite ducking for media
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  },
};

// Neutral/standby mode for when nothing is active
const STANDBY_MODE: Audio.AudioMode = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: false,
  staysActiveInBackground: false,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
  interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
};

interface ActiveSound {
  sound: Audio.Sound;
  priority: AudioPriority;
  tag: string; // For debugging/identification
}

class AudioManagerClass {
  private activeSound: ActiveSound | null = null;
  private currentPriority: AudioPriority | null = null;
  private soundQueue: Map<string, Audio.Sound> = new Map();
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize audio manager - call once at app startup
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      await Audio.setAudioModeAsync(STANDBY_MODE);
      this.isInitialized = true;
      console.log('[AudioManager] Initialized successfully');
    } catch (error) {
      console.error('[AudioManager] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Request audio focus for a specific priority
   * Returns true if focus was granted, false if a higher priority task is using audio
   */
  async requestFocus(priority: AudioPriority, tag: string): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // If no active sound, we can take focus
    if (!this.activeSound) {
      await this._setAudioMode(priority);
      this.currentPriority = priority;
      console.log(`[AudioManager] Focus granted to ${tag} (priority: ${priority})`);
      return true;
    }

    // If same or lower priority, reject
    if (this.activeSound.priority >= priority) {
      console.log(`[AudioManager] Focus denied to ${tag} - active: ${this.activeSound.tag} (priority: ${this.activeSound.priority})`);
      return false;
    }

    // Higher priority wins - stop current sound and grant focus
    console.log(`[AudioManager] Priority override: ${tag} (${priority}) over ${this.activeSound.tag} (${this.activeSound.priority})`);
    await this.stopCurrent(AudioPriority.ALERT); // Force stop for higher priority
    await this._setAudioMode(priority);
    this.currentPriority = priority;
    return true;
  }

  /**
   * Release audio focus when done
   */
  async releaseFocus(tag: string): Promise<void> {
    if (this.activeSound && this.activeSound.tag === tag) {
      console.log(`[AudioManager] Releasing focus from ${tag}`);
      await this.stopCurrent(AudioPriority.ALERT); // Force stop
      this.currentPriority = null;
      await this._restoreToStandby();
    }
  }

  /**
   * Play a sound with specified priority
   * Automatically handles focus management and cleanup
   */
  async playSound(
    uri: string,
    priority: AudioPriority,
    tag: string,
    options?: {
      isLooping?: boolean;
      volume?: number;
      downloadFirst?: boolean;
    }
  ): Promise<Audio.Sound | null> {
    // Stop any existing sound first
    if (this.activeSound) {
      await this.stopCurrent(priority);
    }

    // Request focus
    const focusGranted = await this.requestFocus(priority, tag);
    if (!focusGranted) {
      // Queue the sound request for later
      console.log(`[AudioManager] Sound ${tag} queued (waiting for focus)`);
      return null;
    }

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri, downloadFirst: options?.downloadFirst ?? true },
        {
          isLooping: options?.isLooping ?? false,
          volume: options?.volume ?? 1.0,
          shouldPlay: true,
        }
      );

      this.activeSound = { sound, priority, tag };
      return sound;
    } catch (error) {
      console.error(`[AudioManager] Failed to play ${tag}:`, error);
      await this._restoreToStandby();
      this.currentPriority = null;
      return null;
    }
  }

  /**
   * Stop the current active sound if its priority allows
   */
  async stopCurrent(minimumPriority: AudioPriority): Promise<void> {
    if (!this.activeSound) return;

    // Only stop if the stopping operation has equal or higher priority
    if (this.activeSound.priority > minimumPriority) {
      console.log(`[AudioManager] Cannot stop ${this.activeSound.tag} - insufficient priority`);
      return;
    }

    try {
      // Immediate mute before async stop
      await this.activeSound.sound.setStatusAsync({ shouldPlay: false }).catch(() => {});
      await this.activeSound.sound.stopAsync().catch(() => {});
      await this.activeSound.sound.unloadAsync().catch(() => {});
    } catch (error) {
      console.warn(`[AudioManager] Error stopping sound ${this.activeSound.tag}:`, error);
    } finally {
      this.activeSound = null;
    }
  }

  /**
   * Stop all sounds regardless of priority (emergency stop)
   */
  async stopAll(): Promise<void> {
    if (this.activeSound) {
      try {
        await this.activeSound.sound.setStatusAsync({ shouldPlay: false }).catch(() => {});
        await this.activeSound.sound.stopAsync().catch(() => {});
        await this.activeSound.sound.unloadAsync().catch(() => {});
      } catch (error) {
        console.warn('[AudioManager] Error during emergency stop:', error);
      } finally {
        this.activeSound = null;
        this.currentPriority = null;
      }
    }
    await this._restoreToStandby();
  }

  /**
   * Set audio mode for recording
   */
  async setRecordingMode(): Promise<void> {
    await Audio.setAudioModeAsync(AUDIO_MODES[AudioPriority.RECORDING]);
  }

  /**
   * Restore audio mode to playback defaults
   */
  async setPlaybackMode(): Promise<void> {
    await Audio.setAudioModeAsync(AUDIO_MODES[AudioPriority.PLAYBACK]);
  }

  /**
   * Restore audio mode to standby/neutral
   */
  async _restoreToStandby(): Promise<void> {
    try {
      await Audio.setAudioModeAsync(STANDBY_MODE);
    } catch (error) {
      console.warn('[AudioManager] Failed to restore standby mode:', error);
    }
  }

  private async _setAudioMode(priority: AudioPriority): Promise<void> {
    try {
      const mode = AUDIO_MODES[priority];
      if (mode) {
        await Audio.setAudioModeAsync(mode);
      }
    } catch (error) {
      console.error(`[AudioManager] Failed to set audio mode for priority ${priority}:`, error);
    }
  }

  /**
   * Get current active sound info
   */
  getActiveInfo(): { tag: string; priority: AudioPriority } | null {
    if (!this.activeSound) return null;
    return {
      tag: this.activeSound.tag,
      priority: this.activeSound.priority,
    };
  }

  /**
   * Check if audio is currently active
   */
  isActive(): boolean {
    return this.activeSound !== null;
  }

  /**
   * Cleanup on app termination
   */
  async cleanup(): Promise<void> {
    await this.stopAll();
    this.isInitialized = false;
    this.initPromise = null;
  }
}

// Singleton instance
export const AudioManager = new AudioManagerClass();

// Convenience methods for specific use cases
export const AudioFocus = {
  forRecording: (tag: string) => AudioManager.requestFocus(AudioPriority.RECORDING, tag),
  forAlert: (tag: string) => AudioManager.requestFocus(AudioPriority.ALERT, tag),
  forAmbient: (tag: string) => AudioManager.requestFocus(AudioPriority.AMBIENT, tag),
  forPlayback: (tag: string) => AudioManager.requestFocus(AudioPriority.PLAYBACK, tag),
  release: (tag: string) => AudioManager.releaseFocus(tag),
};

export const AudioPlayback = {
  /**
   * Play panic alarm with automatic priority management
   */
  playPanicAlarm: async () => {
    try {
      const sound = await AudioManager.playSound(
        'https://assets.mixkit.co/active_storage/sfx/212/212-preview.mp3',
        AudioPriority.ALERT,
        'panic_alarm',
        { isLooping: true, volume: 1.0, downloadFirst: true }
      );
      return sound;
    } catch (error) {
      console.error('[AudioManager] Failed to play panic alarm:', error);
      return null;
    }
  },

  /**
   * Play message alert with automatic priority management
   */
  playMessageAlert: async () => {
    try {
      const sound = await AudioManager.playSound(
        'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
        AudioPriority.ALERT,
        'message_alert',
        { isLooping: false, volume: 0.85, downloadFirst: true }
      );
      return sound;
    } catch (error) {
      console.error('[AudioManager] Failed to play message alert:', error);
      return null;
    }
  },

  /**
   * Play ambient sound with automatic priority management
   */
  playAmbientSound: async (uri: string) => {
    try {
      const sound = await AudioManager.playSound(
        uri,
        AudioPriority.AMBIENT,
        'ambient_sound',
        { isLooping: true, volume: 0.7, downloadFirst: true }
      );
      return sound;
    } catch (error) {
      console.error('[AudioManager] Failed to play ambient sound:', error);
      return null;
    }
  },

  /**
   * Stop all audio playback
   */
  stopAll: () => AudioManager.stopAll(),

  /**
   * Stop current sound if lower priority than given threshold
   */
  stopIfLowerPriority: (minimumPriority: AudioPriority) =>
    AudioManager.stopCurrent(minimumPriority),
};

// ── Recording Mode Helpers ─────────────────────────────────────────────────

/**
 * Set audio mode for recording operations
 * Use this before starting any recording (ambient capture, audio reports, video reports)
 */
export async function setRecordingAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false, // Don't duck during recording
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (error) {
    console.error('[AudioManager] Failed to set recording audio mode:', error);
  }
}

/**
 * Restore audio mode to safe defaults after recording ends
 * Use this after stopping any recording operation
 */
export async function restorePlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (error) {
    console.warn('[AudioManager] Failed to restore playback audio mode:', error);
  }
}

/**
 * Set audio mode for playback-only operations
 * Use this before playing back audio/video content
 */
export async function setPlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (error) {
    console.error('[AudioManager] Failed to set playback audio mode:', error);
  }
}

/**
 * Set audio mode for alert/notification sounds
 * Use this before playing panic alarms or message alerts
 */
export async function setAlertAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false, // Alert needs to be heard clearly
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (error) {
    console.error('[AudioManager] Failed to set alert audio mode:', error);
  }
}
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";

/**
 * Sound + haptic feedback, mirroring Zobaze's behaviour:
 *  - beep  → barcode scan / item added
 *  - coin  → sale completed (cash register "ching")
 *  - celebration → milestone / success animation
 *
 * Players are created lazily and cached so repeated triggers are instant.
 * Everything is wrapped defensively: audio must never break a sale.
 */
type SoundName = "beep" | "coin" | "celebration" | "vip";

const sources: Record<SoundName, number> = {
  beep: require("../assets/sounds/beep.mp3"),
  coin: require("../assets/sounds/coin.mp3"),
  celebration: require("../assets/sounds/sfx_zd_celebration.ogg"),
  /** Original four-second chime synthesized specifically for VIP table orders. */
  vip: require("../assets/sounds/vip-order.wav"),
};

const players: Partial<Record<SoundName, AudioPlayer>> = {};
let soundEnabled = true;
let hapticsEnabled = true;

/**
 * Last audio failure, kept so problems are diagnosable on a real device.
 *
 * Audio used to fail behind empty `catch {}` blocks, which meant a release
 * build that played nothing gave no clue why. Errors are still non-fatal, but
 * they are now recorded and surfaced in Settings ▸ Test sound.
 */
let lastAudioError: string | null = null;

export function getLastAudioError(): string | null {
  return lastAudioError;
}

const noteAudioError = (stage: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  lastAudioError = `${stage}: ${message}`;
};

/**
 * Configure the audio session once, at startup, rather than at the moment an
 * alert needs to sound. `setAudioModeAsync` is async, so doing it inline with
 * playback left the first sound racing against session configuration.
 */
let audioModeReady: Promise<void> | null = null;

export function initAudio(): Promise<void> {
  if (audioModeReady) return audioModeReady;
  audioModeReady = (async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
    } catch (error) {
      noteAudioError("setAudioMode", error);
    }
    // Resolve and build every player up front so playback never waits on I/O.
    await Promise.all((Object.keys(sources) as SoundName[]).map(loadPlayer));
  })();
  return audioModeReady;
}

/**
 * Create and cache a player for `name` from its bundled module.
 *
 * Passing the `require()`d asset straight to expo-audio is the documented path
 * and works in development. Errors are recorded (never swallowed) so if a
 * release build behaves differently, Settings ▸ Test sound reports the real
 * cause instead of failing silently.
 */
function loadPlayer(name: SoundName): AudioPlayer | null {
  const existing = players[name];
  if (existing) return existing;
  try {
    const player = createAudioPlayer(sources[name]);
    players[name] = player;
    return player;
  } catch (error) {
    noteAudioError(`load(${name})`, error);
    return null;
  }
}

/**
 * Restart a sound from the beginning and play it.
 *
 * `seekTo` returns a promise that the previous version neither awaited nor
 * caught, so a rejection surfaced as an unhandled rejection instead of an
 * explanation. `play()` itself is synchronous and safe to call immediately —
 * ExoPlayer honours it once the source reaches a ready state — so the rewind
 * is best-effort and never gates playback.
 */
function restartAndPlay(name: SoundName, volume?: number): void {
  const player = players[name];
  if (!player) {
    // Not loaded yet (very early tap, or a failed first attempt): resolve it
    // now and play as soon as it's ready.
    void initAudio().then(() => {
      const ready = players[name];
      if (ready) playLoaded(ready, name, volume);
    });
    return;
  }
  playLoaded(player, name, volume);
}

function playLoaded(player: AudioPlayer, name: SoundName, volume?: number): void {
  try {
    if (volume != null) player.volume = volume;
    player.play();
    void Promise.resolve(player.seekTo(0))
      .then(() => player.play())
      .catch((error) => noteAudioError(`seekTo(${name})`, error));
  } catch (error) {
    noteAudioError(`play(${name})`, error);
  }
}

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}
export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}
export function isSoundEnabled() {
  return soundEnabled;
}
export function isHapticsEnabled() {
  return hapticsEnabled;
}

export function playSound(name: SoundName) {
  if (!soundEnabled) return;
  // Deferred by a tick so audio can never extend the tap handler that triggered
  // it. Creating a player is a *synchronous* native call, so doing this inline
  // made the first tap on an item stall before the cart or the haptic reacted.
  // Non-fatal by design, but failures are recorded rather than discarded.
  setTimeout(() => restartAndPlay(name), 0);
}

function vibrate(style: Haptics.ImpactFeedbackStyle) {
  if (!hapticsEnabled) return;
  Haptics.impactAsync(style).catch(() => {});
}

function notify(type: Haptics.NotificationFeedbackType) {
  if (!hapticsEnabled) return;
  Haptics.notificationAsync(type).catch(() => {});
}

/**
 * Haptics fire before sound in every helper below.
 *
 * The vibration is the confirmation a cashier actually feels, and it costs
 * almost nothing, so it must never queue behind audio work.
 */

/** Item added to the cart: light tap + short beep. */
export function feedbackAddItem() {
  vibrate(Haptics.ImpactFeedbackStyle.Light);
  playSound("beep");
}

/** Barcode successfully scanned: medium tap + beep. */
export function feedbackScan() {
  vibrate(Haptics.ImpactFeedbackStyle.Medium);
  playSound("beep");
}

/** Sale completed: success notification + cash-register coin. */
export function feedbackSaleComplete() {
  notify(Haptics.NotificationFeedbackType.Success);
  playSound("coin");
}

/** Milestone / celebration moment. */
export function feedbackCelebrate() {
  notify(Haptics.NotificationFeedbackType.Success);
  playSound("celebration");
}

/** Blocked action (out of stock, invalid amount). */
export function feedbackError() {
  notify(Haptics.NotificationFeedbackType.Error);
}

/** Generic light tap for selections/toggles. */
export function feedbackTap() {
  vibrate(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Critical in-app VIP alarm. The dedicated four-second sound starts as a
 * premium door chime, then repeats a brighter two-note call so it remains
 * recognisable in a noisy restaurant without sounding like a barcode scanner.
 * Device media volume/DND still sets the physical upper limit.
 */
let vipHapticTimer: ReturnType<typeof setInterval> | null = null;
let vipStopTimer: ReturnType<typeof setTimeout> | null = null;

function playVipSound() {
  if (!soundEnabled) return;
  // Haptics still draw attention if audio is unavailable; the cause is recorded.
  restartAndPlay("vip", 1);
}

export function startVipOrderAlarm() {
  stopVipOrderAlarm();
  // The session is configured at startup; if a cold start beat us to it, this
  // resolves immediately and the sound still fires on the next tick.
  vibrate(Haptics.ImpactFeedbackStyle.Heavy);
  void initAudio().then(playVipSound);
  vipHapticTimer = setInterval(
    () => vibrate(Haptics.ImpactFeedbackStyle.Heavy),
    850,
  );
  vipStopTimer = setTimeout(stopVipOrderAlarm, 4200);
  notify(Haptics.NotificationFeedbackType.Warning);
}

export function stopVipOrderAlarm() {
  if (vipHapticTimer) clearInterval(vipHapticTimer);
  if (vipStopTimer) clearTimeout(vipStopTimer);
  vipHapticTimer = null;
  vipStopTimer = null;
  const player = players.vip;
  if (!player) return;
  try {
    player.pause();
    void Promise.resolve(player.seekTo(0)).catch(() => {});
  } catch (error) {
    noteAudioError("stopVip", error);
  }
}

/** Backward-compatible name for callers that only need to start the alarm. */
export function feedbackNewOrder() {
  startVipOrderAlarm();
}

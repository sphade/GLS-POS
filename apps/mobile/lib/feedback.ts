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
  try {
    let player = players[name];
    if (!player) {
      player = createAudioPlayer(sources[name]);
      players[name] = player;
    }
    player.seekTo(0);
    player.play();
  } catch {
    // Non-fatal: audio is a nicety, never block the POS flow.
  }
}

function vibrate(style: Haptics.ImpactFeedbackStyle) {
  if (!hapticsEnabled) return;
  Haptics.impactAsync(style).catch(() => {});
}

function notify(type: Haptics.NotificationFeedbackType) {
  if (!hapticsEnabled) return;
  Haptics.notificationAsync(type).catch(() => {});
}

/** Item added to the cart: short beep + light tap. */
export function feedbackAddItem() {
  playSound("beep");
  vibrate(Haptics.ImpactFeedbackStyle.Light);
}

/** Barcode successfully scanned: beep + medium tap. */
export function feedbackScan() {
  playSound("beep");
  vibrate(Haptics.ImpactFeedbackStyle.Medium);
}

/** Sale completed: cash-register coin + success notification. */
export function feedbackSaleComplete() {
  playSound("coin");
  notify(Haptics.NotificationFeedbackType.Success);
}

/** Milestone / celebration moment. */
export function feedbackCelebrate() {
  playSound("celebration");
  notify(Haptics.NotificationFeedbackType.Success);
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
  try {
    let player = players.vip;
    if (!player) {
      player = createAudioPlayer(sources.vip);
      players.vip = player;
    }
    player.volume = 1;
    player.seekTo(0);
    player.play();
  } catch {
    /* haptics still draw attention if audio is unavailable */
  }
}

export function startVipOrderAlarm() {
  stopVipOrderAlarm();
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => {});
  playVipSound();
  vibrate(Haptics.ImpactFeedbackStyle.Heavy);
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
  try {
    players.vip?.pause();
    players.vip?.seekTo(0);
  } catch {
    /* already stopped */
  }
}

/** Backward-compatible name for callers that only need to start the alarm. */
export function feedbackNewOrder() {
  startVipOrderAlarm();
}

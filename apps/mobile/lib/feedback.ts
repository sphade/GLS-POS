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
type SoundName = "beep" | "coin" | "celebration";

const sources: Record<SoundName, number> = {
  beep: require("../assets/sounds/beep.mp3"),
  coin: require("../assets/sounds/coin.mp3"),
  celebration: require("../assets/sounds/sfx_zd_celebration.ogg"),
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
 * Critical in-app VIP alarm. It runs for roughly four seconds unless staff
 * dismiss or attend first. We repeat the bundled sharp sounds because they cut
 * through restaurant noise better than the short two-chime notification did.
 * Device media volume/DND still sets the physical upper limit.
 */
let vipPulseTimer: ReturnType<typeof setInterval> | null = null;
let vipStopTimer: ReturnType<typeof setTimeout> | null = null;
let vipPulse = 0;

function playVipPulse() {
  const name: SoundName = vipPulse++ % 3 === 0 ? "coin" : "beep";
  if (soundEnabled) {
    try {
      let player = players[name];
      if (!player) {
        player = createAudioPlayer(sources[name]);
        players[name] = player;
      }
      player.volume = 1;
      player.seekTo(0);
      player.play();
    } catch {
      /* haptics still draw attention if audio is unavailable */
    }
  }
  vibrate(Haptics.ImpactFeedbackStyle.Heavy);
}

export function startVipOrderAlarm() {
  stopVipOrderAlarm();
  vipPulse = 0;
  void setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => {});
  playVipPulse();
  vipPulseTimer = setInterval(playVipPulse, 600);
  vipStopTimer = setTimeout(stopVipOrderAlarm, 4200);
  notify(Haptics.NotificationFeedbackType.Warning);
}

export function stopVipOrderAlarm() {
  if (vipPulseTimer) clearInterval(vipPulseTimer);
  if (vipStopTimer) clearTimeout(vipStopTimer);
  vipPulseTimer = null;
  vipStopTimer = null;
  for (const name of ["beep", "coin"] as const) {
    try {
      players[name]?.pause();
      players[name]?.seekTo(0);
    } catch {
      /* already stopped */
    }
  }
}

/** Backward-compatible name for callers that only need to start the alarm. */
export function feedbackNewOrder() {
  startVipOrderAlarm();
}

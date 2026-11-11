import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { formatDuration } from "./data";
import { loadSettings } from "./settings";
import type { CompletionSound, FocusSettings } from "./settings";
import type { TimerState } from "./timerState";
import i18n from "./i18n";

const soundProfiles: Record<CompletionSound, { frequencies: number[]; type: OscillatorType; duration: number }> = {
  "soft-chime": { frequencies: [660, 880], type: "sine", duration: 0.52 },
  bell: { frequencies: [784, 1046], type: "sine", duration: 0.7 },
  digital: { frequencies: [740, 988], type: "square", duration: 0.28 },
  gentle: { frequencies: [523, 659], type: "sine", duration: 0.62 },
  bright: { frequencies: [880, 1175], type: "triangle", duration: 0.42 },
};

function playCompletionSound(choice: CompletionSound, volume: number) {
  const context = new AudioContext();
  const profile = soundProfiles[choice];
  profile.frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * 0.13;
    oscillator.type = profile.type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(1, volume / 100) * 0.12), start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + profile.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + profile.duration + 0.01);
  });
  window.setTimeout(() => void context.close(), (profile.duration + 0.3) * 1000);
}

async function sendFocusNotification(title: string, body: string) {
  if (!isTauri()) throw new Error("Notifications are available in the Shunhen desktop app.");
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) throw new Error("Notification permission was not granted.");
  sendNotification({ title, body });
}

export async function testCompletionNotification() {
  await sendFocusNotification(
    i18n.t("Shunhen notifications are working"),
    i18n.t("You will be notified when a focus Session finishes."),
  );
}

export function previewCompletionSound(
  settings: Pick<FocusSettings, "completionSoundChoice" | "completionSoundVolume">,
) {
  playCompletionSound(settings.completionSoundChoice, settings.completionSoundVolume);
}

export async function handleTimerCompletion(state: TimerState) {
  const settings = await loadSettings();
  if (settings.completionSound)
    try {
      playCompletionSound(settings.completionSoundChoice, settings.completionSoundVolume);
    } catch {
      /* Feedback must not block Session persistence. */
    }
  if (settings.completionNotification && isTauri()) {
    try {
      await sendFocusNotification(
        i18n.t("Shunhen session complete"),
        i18n.t("{{subject}} - {{duration}}", {
          subject: state.subject,
          duration: formatDuration(state.plannedDurationSeconds),
        }),
      );
    } catch {
      /* Notification denial must not interrupt Session persistence. */
    }
  }
  // Popout closure follows active-session lifecycle, independently of feedback preferences.
}

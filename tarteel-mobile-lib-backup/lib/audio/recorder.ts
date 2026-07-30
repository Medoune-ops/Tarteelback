/**
 * Enregistrement micro — helpers autour d'expo-audio (SDK 54).
 *
 * Les écrans utilisent le hook `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`
 * d'expo-audio directement ; ce module centralise ce qui est partagé :
 *
 *  - la demande de permission micro (avec message si refusée) ;
 *  - la bascule du mode audio : iOS exige `allowsRecording: true` pour
 *    enregistrer, mais ce mode baisse le volume de lecture — il faut donc
 *    le désactiver dès qu'on a fini (sinon les récitations audio de l'app
 *    deviennent quasi inaudibles).
 */
import { AudioModule, setAudioModeAsync } from 'expo-audio';

/** Demande (si besoin) la permission micro. true si accordée. */
export async function ensureMicPermission(): Promise<boolean> {
  try {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/** À appeler AVANT recorder.record() — active la session d'enregistrement. */
export async function enterRecordingMode(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  } catch {
    // best-effort : sur web/simulateur le mode peut être indisponible
  }
}

/** À appeler APRÈS l'enregistrement — rétablit le mode lecture normal. */
export async function exitRecordingMode(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch {
    // best-effort
  }
}

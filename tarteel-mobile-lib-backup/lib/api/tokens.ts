/**
 * Stockage des jetons d'authentification et de l'identifiant d'appareil.
 *
 * On persiste dans AsyncStorage (déjà utilisé par le store Zustand). Pour un
 * stockage chiffré au niveau OS, on pourra migrer vers `expo-secure-store`
 * plus tard sans changer l'interface ci-dessous.
 *
 * Le backend identifie chaque session par un `deviceId` stable (voir
 * `POST /auth/refresh { refreshToken, deviceId }`). On en génère un une fois
 * par installation et on le réutilise.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_KEY = 'tarteel.accessToken';
const REFRESH_KEY = 'tarteel.refreshToken';
const DEVICE_KEY = 'tarteel.deviceId';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/** Lit l'access token courant (null si déconnecté). */
export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_KEY);
}

/** Lit le refresh token courant (null si déconnecté). */
export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_KEY);
}

/** Enregistre la paire de jetons (après login/register/refresh). */
export async function setTokens(tokens: StoredTokens): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCESS_KEY, tokens.accessToken],
    [REFRESH_KEY, tokens.refreshToken],
  ]);
}

/** Efface les jetons (déconnexion). Le deviceId est conservé. */
export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
}

/**
 * Identifiant d'installation, stable et persistant. Généré au premier appel.
 * Format simple sans dépendance native (suffisant pour distinguer les sessions).
 */
export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

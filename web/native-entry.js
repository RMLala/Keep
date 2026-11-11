import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
window.PasskeepBiometricAuth = BiometricAuth;
window.PasskeepSecureStorage = SecureStorage;
window.dispatchEvent(new Event('passkeep-native-ready'));

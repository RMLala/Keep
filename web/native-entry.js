import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { registerPlugin } from '@capacitor/core';
const NativeBackupSave = registerPlugin('PasskeepBackupSave');
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';
window.PasskeepBiometricAuth = BiometricAuth;
window.PasskeepSecureStorage = SecureStorage;
window.XLSX = XLSX;
window.PasskeepFiles = {
  async copy(text) {
    if (!window.Capacitor?.isNativePlatform?.()) throw new Error('Copie native indisponible.');
    return await NativeBackupSave.copyText({ text: String(text ?? '') });
  },
  async save(blob, name) {
    if (!window.Capacitor?.isNativePlatform?.()) throw new Error('Enregistrement natif indisponible.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture du fichier chiffré impossible.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
    return await NativeBackupSave.saveFile({ name, data });
  }
};
window.dispatchEvent(new Event('passkeep-native-ready'));

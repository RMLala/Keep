import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as XLSX from 'xlsx';
window.PasskeepBiometricAuth = BiometricAuth;
window.PasskeepSecureStorage = SecureStorage;
window.XLSX = XLSX;
window.PasskeepFiles = {
  async save(blob, name) {
    if (!window.Capacitor?.isNativePlatform?.()) throw new Error('Enregistrement natif indisponible.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
    const saved = await Filesystem.writeFile({ path: name, data: dataUrl, directory: Directory.Cache, recursive: true });
    await Share.share({ title: name, text: 'Fichier Passkeep', files: [saved.uri], dialogTitle: 'Enregistrer ou partager le fichier' });
  }
};
window.dispatchEvent(new Event('passkeep-native-ready'));

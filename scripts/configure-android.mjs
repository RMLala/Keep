import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const path='android/app/build.gradle';
if(!existsSync(path)) throw new Error('android/app/build.gradle absent; exécutez npx cap add android avant ce script.');
let s=await readFile(path,'utf8');
if(!s.includes('productFlavors')) {
  s=s.replace(/defaultConfig\s*\{/, `flavorDimensions += "api"
    productFlavors {
        api23 { dimension "api"; minSdk 23 }
        api29 { dimension "api"; minSdk 29 }
    }
    defaultConfig {`);
}
if(!s.includes('signingConfigs')) {
  s=s.replace(/android\s*\{/, `android {
    signingConfigs {
        release {
            if (System.getenv('PASSKEEP_STORE_FILE')) {
                storeFile file(System.getenv('PASSKEEP_STORE_FILE'))
                storePassword System.getenv('PASSKEEP_STORE_PASSWORD')
                keyAlias System.getenv('PASSKEEP_KEY_ALIAS')
                keyPassword System.getenv('PASSKEEP_KEY_PASSWORD')
            }
        }
    }`);
}
if(!s.includes('signingConfig signingConfigs.release')) s=s.replace(/buildTypes\s*\{\s*release\s*\{/, `buildTypes {\n        release {\n            signingConfig signingConfigs.release`);
s=s.replace(/versionCode\s+\d+/, 'versionCode project.findProperty("versionCode")?.toInteger() ?: 1').replace(/versionName\s+"[^"]+"/, 'versionName "1.0.0"');
await writeFile(path,s);

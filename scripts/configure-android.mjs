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
s=s.replace(/versionCode\s+\d+/, 'versionCode project.findProperty("versionCode")?.toInteger() ?: 1').replace(/versionName\s+"[^"]+"/, 'versionName "1.1.2"');
await writeFile(path,s);

import { mkdir } from 'node:fs/promises';
const res='android/app/src/main/res';
const foreground='<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512"><path android:fillColor="#0c1720" android:pathData="M0,0h512v512h-512z"/><path android:fillColor="#78efd0" android:pathData="M40,40h432v432h-432z"/><path android:fillColor="#092a25" android:pathData="M256,142l92,92 -92,92 -92,-92z"/><path android:fillColor="#7cebd0" android:pathData="M256,178l56,56 -56,56 -56,-56z"/><path android:fillColor="#0b2825" android:pathData="M222,270h68v90h-68z"/><path android:strokeColor="#0b2825" android:strokeWidth="16" android:strokeLineCap="round" android:pathData="M237,270v-26a19,19 0,0 1,38 0v26"/><path android:fillColor="#7cebd0" android:pathData="M247,301a9,9 0,1 0,18 0a9,9 0 1 0,-18 0"/><path android:fillColor="#7cebd0" android:pathData="M252,318h8v18h-8z"/></vector>';
const adaptive='<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/ic_passkeep_foreground"/></adaptive-icon>';
const legacy='<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="512" android:viewportHeight="512"><path android:fillColor="#0c1720" android:pathData="M0,0h512v512h-512z"/><path android:fillColor="#78efd0" android:pathData="M40,40h432v432h-432z"/><path android:fillColor="#092a25" android:pathData="M256,142l92,92 -92,92 -92,-92z"/><path android:fillColor="#7cebd0" android:pathData="M256,178l56,56 -56,56 -56,-56z"/><path android:fillColor="#0b2825" android:pathData="M222,270h68v90h-68z"/><path android:strokeColor="#0b2825" android:strokeWidth="16" android:strokeLineCap="round" android:pathData="M237,270v-26a19,19 0 0 1 38 0v26"/></vector>';
const color='<resources><color name="ic_launcher_background">#0C1720</color></resources>';
await mkdir(res+'/drawable',{recursive:true});await mkdir(res+'/mipmap-anydpi-v26',{recursive:true});await mkdir(res+'/mipmap-anydpi',{recursive:true});await mkdir(res+'/values',{recursive:true});
await writeFile(res+'/drawable/ic_passkeep_foreground.xml',foreground);await writeFile(res+'/mipmap-anydpi-v26/ic_launcher.xml',adaptive);await writeFile(res+'/mipmap-anydpi/ic_launcher.xml',legacy);await writeFile(res+'/values/ic_launcher_background.xml',color);
console.log('Passkeep custom launcher icon resources installed.');

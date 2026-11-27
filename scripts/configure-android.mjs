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

/* Native Android Save As bridge using the Storage Access Framework (SAF).
   The picker lets the user select Downloads/Backup and confirms only after bytes are written. */
const pluginJava = `package com.passkeep.app;

import android.content.Intent;
import android.net.Uri;
import java.io.OutputStream;
import java.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.ActivityResult;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PasskeepBackupSave")
public class PasskeepBackupSavePlugin extends Plugin {
  private PluginCall pendingCall;
  @PluginMethod
  public void saveFile(PluginCall call) {
    String name = call.getString("name");\n    if (name == null || name.isEmpty()) name = "Passkeep_Backup.gdm";
    pendingCall = call;
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("application/octet-stream");
    intent.putExtra(Intent.EXTRA_TITLE, name);
    startActivityForResult(call, intent, "handleSaveResult");
  }
  @ActivityCallback
  private void handleSaveResult(PluginCall call, androidx.activity.result.ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
      call.reject("Enregistrement annulé.");
      pendingCall = null;
      return;
    }
    try {
      Uri uri = result.getData().getData();
      String base64 = call.getString("data");
      byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
      try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
        if (out == null) throw new IllegalStateException("Destination inaccessible");
        out.write(bytes);
        out.flush();
      }
      call.resolve(new com.getcapacitor.JSObject().put("uri", uri.toString()).put("bytes", bytes.length));
    } catch (Exception ex) {
      call.reject("Échec de l'enregistrement : " + ex.getMessage(), ex);
    } finally {
      pendingCall = null;
    }
  }
}
`;
const javaDir = 'android/app/src/main/java/com/passkeep/app';
await mkdir(javaDir, { recursive: true });
await writeFile(javaDir + '/PasskeepBackupSavePlugin.java', pluginJava);
const mainJava = javaDir + '/MainActivity.java';
if (existsSync(mainJava)) {
  let m = await readFile(mainJava, 'utf8');
  if (!m.includes('PasskeepBackupSavePlugin')) {
    m = m.replace(/import com\.getcapacitor\.BridgeActivity;?/, 'import com.getcapacitor.BridgeActivity;\nimport com.passkeep.app.PasskeepBackupSavePlugin;');
    m = m.replace(/class MainActivity extends BridgeActivity \{/, 'class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(PasskeepBackupSavePlugin.class);\n        super.onCreate(savedInstanceState);\n    }');
    await writeFile(mainJava, m);
  }
} else {
  throw new Error('MainActivity.java absent; custom SAF plugin cannot be registered safely.');
}
console.log('Passkeep Android SAF Save As plugin installed.');

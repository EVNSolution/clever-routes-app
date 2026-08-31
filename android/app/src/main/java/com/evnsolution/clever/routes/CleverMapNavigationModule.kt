package com.evnsolution.clever.routes

import android.content.Intent
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class CleverMapNavigationModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "CleverMapNavigation"

  @ReactMethod
  fun open(url: String, promise: Promise) {
    if (!url.startsWith("clever-routes-map://navigate?")) {
      promise.reject("invalid_destination", "Unsupported map navigation request.")
      return
    }

    try {
      val launchIntent = Intent(reactApplicationContext, MapNavigationActivity::class.java)
        .putExtra(MapNavigationActivity.EXTRA_DESTINATION_URL, url)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(launchIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("map_navigation_failed", "Map navigation could not be opened.", error)
    }
  }

  @ReactMethod
  fun openDefaultAppsSettings(promise: Promise) {
    try {
      val defaultAppsIntent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
      val launchIntent = if (
        defaultAppsIntent.resolveActivity(reactApplicationContext.packageManager) != null
      ) {
        defaultAppsIntent
      } else {
        Intent(Settings.ACTION_SETTINGS)
      }
      launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(launchIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("default_apps_settings_failed", "Default app settings could not be opened.", error)
    }
  }
}

class CleverMapNavigationPackage : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(CleverMapNavigationModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

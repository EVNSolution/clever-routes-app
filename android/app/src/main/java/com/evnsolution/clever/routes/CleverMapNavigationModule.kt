package com.evnsolution.clever.routes

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class CleverMapNavigationModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private var pendingPickerPromise: Promise? = null

  private val pickerListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != REQUEST_PICK_MAP_APP) return

      val promise = pendingPickerPromise ?: return
      pendingPickerPromise = null
      val packageName = if (resultCode == Activity.RESULT_OK) {
        data?.component?.packageName
      } else {
        null
      }
      promise.resolve(packageName)
    }
  }

  init {
    reactContext.addActivityEventListener(pickerListener)
  }

  override fun getName(): String = "CleverMapNavigation"

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(pickerListener)
    pendingPickerPromise?.reject("map_picker_interrupted", "Map app selection was interrupted.")
    pendingPickerPromise = null
    super.invalidate()
  }

  @ReactMethod
  fun pickMapApp(url: String?, promise: Promise) {
    if (pendingPickerPromise != null) {
      promise.reject("map_picker_in_progress", "Map app selection is already open.")
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("map_picker_unavailable", "Map app selection requires the active app screen.")
      return
    }

    val targetIntent = if (url.isNullOrBlank()) {
      Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0"))
    } else {
      val destination = readDestination(Uri.parse(url))
      if (destination == null) {
        promise.reject("invalid_destination", "Unsupported map navigation request.")
        return
      }
      buildGenericMapIntent(destination)
    }

    val pickerIntent = Intent(Intent.ACTION_PICK_ACTIVITY)
      .putExtra(Intent.EXTRA_INTENT, targetIntent)
      .putExtra(Intent.EXTRA_TITLE, "Choose default map app")

    try {
      pendingPickerPromise = promise
      activity.startActivityForResult(pickerIntent, REQUEST_PICK_MAP_APP)
    } catch (error: ActivityNotFoundException) {
      pendingPickerPromise = null
      promise.reject("map_picker_unavailable", "No Android map app picker is available.", error)
    } catch (error: SecurityException) {
      pendingPickerPromise = null
      promise.reject("map_picker_unavailable", "Android blocked map app selection.", error)
    }
  }

  @ReactMethod
  fun open(url: String, packageName: String, promise: Promise) {
    val destination = readDestination(Uri.parse(url))
    if (destination == null || packageName.isBlank()) {
      promise.reject("invalid_destination", "Unsupported map navigation request.")
      return
    }

    val uri = if (packageName == WAZE_PACKAGE) {
      buildWazeUri(destination)
    } else {
      buildGenericMapIntent(destination).data!!
    }
    val launchIntent = Intent(Intent.ACTION_VIEW, uri)
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (resolveActivity(launchIntent) == null) {
      promise.reject("map_app_unavailable", "The selected map app is no longer available.")
      return
    }

    try {
      reactApplicationContext.startActivity(launchIntent)
      promise.resolve(null)
    } catch (error: ActivityNotFoundException) {
      promise.reject("map_app_unavailable", "The selected map app is no longer available.", error)
    } catch (error: SecurityException) {
      promise.reject("map_app_unavailable", "Android blocked the selected map app.", error)
    }
  }

  private fun readDestination(uri: Uri?): StopNavigationDestination? {
    if (uri?.scheme != INTERNAL_SCHEME || uri.host != INTERNAL_HOST) return null

    val address = uri.getQueryParameter("address")?.trim()?.takeIf(String::isNotEmpty)
    val latitude = uri.getQueryParameter("latitude")?.toDoubleOrNull()
    val longitude = uri.getQueryParameter("longitude")?.toDoubleOrNull()
    val hasCoordinates = latitude != null && longitude != null && isValidCoordinates(latitude, longitude)
    if (address == null && !hasCoordinates) return null

    return StopNavigationDestination(
      address = address,
      latitude = latitude?.takeIf { hasCoordinates },
      longitude = longitude?.takeIf { hasCoordinates },
      target = uri.getQueryParameter("target")?.takeIf { it == "address" } ?: "coordinates",
    )
  }

  private fun buildGenericMapIntent(destination: StopNavigationDestination): Intent {
    val coordinates = destination.coordinatePair()
    val uri = when {
      destination.target == "address" && destination.address != null ->
        Uri.parse("geo:0,0").buildUpon().appendQueryParameter("q", destination.address).build()
      coordinates != null ->
        Uri.parse("geo:$coordinates").buildUpon()
          .appendQueryParameter("q", destination.address ?: coordinates)
          .build()
      else ->
        Uri.parse("geo:0,0").buildUpon().appendQueryParameter("q", destination.address).build()
    }
    return Intent(Intent.ACTION_VIEW, uri)
  }

  private fun buildWazeUri(destination: StopNavigationDestination): Uri {
    val builder = Uri.parse(WAZE_URL).buildUpon()
    val coordinates = destination.coordinatePair()
    destination.address?.let { builder.appendQueryParameter("q", it) }
    coordinates?.let { builder.appendQueryParameter("ll", it) }
    builder.appendQueryParameter("navigate", "yes")
    return builder.build()
  }

  private fun resolveActivity(intent: Intent): ResolveInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactApplicationContext.packageManager.resolveActivity(
        intent,
        PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      reactApplicationContext.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
    }

  private fun isValidCoordinates(latitude: Double, longitude: Double): Boolean =
    latitude.isFinite() && latitude in -90.0..90.0 &&
      longitude.isFinite() && longitude in -180.0..180.0 &&
      (latitude != 0.0 || longitude != 0.0)

  private data class StopNavigationDestination(
    val address: String?,
    val latitude: Double?,
    val longitude: Double?,
    val target: String,
  ) {
    fun coordinatePair(): String? =
      if (latitude != null && longitude != null) "$latitude,$longitude" else null
  }

  companion object {
    private const val REQUEST_PICK_MAP_APP = 4102
    private const val INTERNAL_SCHEME = "clever-routes-map"
    private const val INTERNAL_HOST = "navigate"
    private const val WAZE_PACKAGE = "com.waze"
    private const val WAZE_URL = "https://waze.com/ul"
  }
}

class CleverMapNavigationPackage : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(CleverMapNavigationModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

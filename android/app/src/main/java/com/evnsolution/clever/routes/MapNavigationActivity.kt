package com.evnsolution.clever.routes

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast

class MapNavigationActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val destination = readDestination(
      intent.getStringExtra(EXTRA_DESTINATION_URL)?.let(Uri::parse),
    )
    val genericIntent = destination?.let(::buildGenericMapIntent)
    if (destination == null || genericIntent == null) {
      showFailureAndFinish()
      return
    }

    val launchIntent = resolveDefaultPackage(genericIntent)
      ?.let { buildIntentForPackage(it, destination) }
      ?: genericIntent
    openMapIntent(launchIntent)
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

  private fun buildGenericMapIntent(destination: StopNavigationDestination): Intent? {
    val coordinates = destination.coordinatePair()
    val uri = when {
      destination.target == "address" && destination.address != null ->
        Uri.parse("geo:0,0").buildUpon().appendQueryParameter("q", destination.address).build()
      coordinates != null ->
        Uri.parse("geo:$coordinates").buildUpon()
          .appendQueryParameter("q", destination.address ?: coordinates)
          .build()
      destination.address != null ->
        Uri.parse("geo:0,0").buildUpon().appendQueryParameter("q", destination.address).build()
      else -> null
    }
    return uri?.let { Intent(Intent.ACTION_VIEW, it) }
  }

  private fun buildIntentForPackage(
    packageName: String,
    destination: StopNavigationDestination,
  ): Intent {
    val uri = if (packageName == WAZE_PACKAGE) {
      buildWazeUri(destination)
    } else {
      buildGenericMapIntent(destination)!!.data!!
    }
    return Intent(Intent.ACTION_VIEW, uri).setPackage(packageName)
  }

  private fun buildWazeUri(destination: StopNavigationDestination): Uri {
    val builder = Uri.parse(WAZE_URL).buildUpon()
    if (destination.address != null) {
      builder.appendQueryParameter("q", destination.address)
      destination.coordinatePair()?.let { builder.appendQueryParameter("ll", it) }
    } else {
      builder.appendQueryParameter("ll", destination.coordinatePair())
    }
    return builder.appendQueryParameter("navigate", "yes").build()
  }

  private fun resolveDefaultPackage(intent: Intent): String? {
    val resolved = resolveActivity(intent) ?: return null
    val packageName = resolved.activityInfo?.packageName ?: return null
    val activityName = resolved.activityInfo?.name.orEmpty()
    return packageName.takeUnless {
      it == "android" || activityName.contains("ResolverActivity") || activityName.contains("ChooserActivity")
    }
  }

  private fun resolveActivity(intent: Intent): ResolveInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.resolveActivity(
        intent,
        PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
    }

  private fun showFailureAndFinish() {
    Toast.makeText(this, "No map app could open this stop.", Toast.LENGTH_LONG).show()
    finish()
  }

  private fun openMapIntent(intent: Intent) {
    try {
      startActivity(intent)
      finish()
    } catch (_: ActivityNotFoundException) {
      showFailureAndFinish()
    } catch (_: SecurityException) {
      showFailureAndFinish()
    }
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
    const val EXTRA_DESTINATION_URL = "clever.mapNavigation.destinationUrl"

    private const val INTERNAL_SCHEME = "clever-routes-map"
    private const val INTERNAL_HOST = "navigate"
    private const val WAZE_PACKAGE = "com.waze"
    private const val WAZE_URL = "https://waze.com/ul"
  }
}

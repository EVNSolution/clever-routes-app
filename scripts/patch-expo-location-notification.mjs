import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patches = [
  {
    file: 'node_modules/expo-location/expo-module.config.json',
    before: `  "android": {\n    "modules": ["expo.modules.location.LocationModule"],\n    "publication": {\n      "groupId": "host.exp.exponent",\n      "artifactId": "expo.modules.location",\n      "version": "56.0.21",\n      "repository": "local-maven-repo"\n    }\n  }`,
    after: `  "android": {\n    "modules": ["expo.modules.location.LocationModule"]\n  }`,
  },
  {
    file: 'node_modules/expo-location/src/Location.types.ts',
    before: `  notificationBody: string;\n  /**\n   * Color of the foreground service notification.`,
    after: `  notificationBody: string;\n  /**\n   * Text shown when the Android foreground notification is expanded.\n   */\n  notificationBigText?: string;\n  /**\n   * Deep link opened when the Android foreground notification is pressed.\n   */\n  notificationUrl?: string;\n  /**\n   * Color of the foreground service notification.`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/records/LocationArguments.kt',
    before: `  @Field var notificationBody: String? = null,\n  @Field var killServiceOnDestroy: Boolean? = null,`,
    after: `  @Field var notificationBody: String? = null,\n  @Field var notificationBigText: String? = null,\n  @Field var notificationUrl: String? = null,\n  @Field var killServiceOnDestroy: Boolean? = null,`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/records/LocationArguments.kt',
    before: `    "notificationBody" to notificationBody,\n    "killServiceOnDestroy" to killServiceOnDestroy,`,
    after: `    "notificationBody" to notificationBody,\n    "notificationBigText" to notificationBigText,\n    "notificationUrl" to notificationUrl,\n    "killServiceOnDestroy" to killServiceOnDestroy,`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt',
    before: `import expo.modules.location.records.LocationTaskOptions\nimport expo.modules.location.records.MotionActivitiesRecord`,
    after: `import expo.modules.location.records.LocationTaskOptions\nimport expo.modules.location.records.LocationTaskServiceOptions\nimport expo.modules.location.services.LocationTaskService\nimport expo.modules.location.records.MotionActivitiesRecord`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt',
    before: `    AsyncFunction("stopLocationUpdatesAsync") { taskName: String ->\n      mTaskManager.unregisterTask(taskName, LocationTaskConsumer::class.java)\n      return@AsyncFunction\n    }`,
    after: `    AsyncFunction("updateLocationTaskNotificationAsync") { taskName: String, options: LocationTaskServiceOptions ->\n      val serviceOptions = Bundle().apply {\n        putString("notificationTitle", options.notificationTitle)\n        putString("notificationBody", options.notificationBody)\n        putString("notificationBigText", options.notificationBigText)\n        putString("notificationUrl", options.notificationUrl)\n        putString("notificationColor", options.notificationColor)\n      }\n      return@AsyncFunction LocationTaskService.updateNotification(taskName, serviceOptions)\n    }\n\n    AsyncFunction("stopLocationUpdatesAsync") { taskName: String ->\n      mTaskManager.unregisterTask(taskName, LocationTaskConsumer::class.java)\n      return@AsyncFunction\n    }`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `import android.content.pm.PackageManager\nimport android.graphics.Color\nimport android.os.Binder\nimport android.os.Build\nimport android.os.Bundle\nimport android.os.IBinder`,
    after: `import android.content.pm.PackageManager\nimport android.graphics.Color\nimport android.graphics.Typeface\nimport android.net.Uri\nimport android.os.Binder\nimport android.os.Build\nimport android.os.Bundle\nimport android.os.IBinder\nimport android.text.Spannable\nimport android.text.SpannableStringBuilder\nimport android.text.style.StyleSpan`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `import android.text.style.StyleSpan\n\nclass LocationTaskService`,
    after: `import android.text.style.StyleSpan\nimport java.util.concurrent.ConcurrentHashMap\n\nclass LocationTaskService`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  private var mChannelId: String? = null\n  private var mKillService = false`,
    after: `  private var mChannelId: String? = null\n  private var mKillService = false\n  private var mTaskName: String? = null`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `      mChannelId = extras.getString("appId") + ":" + extras.getString("taskName")\n      mKillService = extras.getBoolean("killService", false)`,
    after: `      mTaskName = extras.getString("taskName")\n      mChannelId = extras.getString("appId") + ":" + mTaskName\n      mKillService = extras.getBoolean("killService", false)\n      mTaskName?.let { sActiveServices[it] = this }`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  override fun onTaskRemoved(rootIntent: Intent) {`,
    after: `  override fun onDestroy() {\n    mTaskName?.let { sActiveServices.remove(it, this) }\n    super.onDestroy()\n  }\n\n  override fun onTaskRemoved(rootIntent: Intent) {`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  fun startForeground(serviceOptions: Bundle) {\n    val notification = buildServiceNotification(serviceOptions)\n    startForeground(mServiceId, notification)\n  }`,
    after: `  fun startForeground(serviceOptions: Bundle) {\n    val notification = buildServiceNotification(serviceOptions)\n    startForeground(mServiceId, notification)\n  }\n\n  private fun updateForeground(serviceOptions: Bundle): Boolean {\n    if (!::mParentContext.isInitialized || mChannelId == null) {\n      return false\n    }\n    startForeground(serviceOptions)\n    return true\n  }`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    val body = serviceOptions.getString("notificationBody")\n    val color = colorStringToInteger(serviceOptions.getString("notificationColor"))`,
    after: `    val body = serviceOptions.getString("notificationBody")\n    val bigText = serviceOptions.getString("notificationBigText")\n    val notificationUrl = serviceOptions.getString("notificationUrl")\n    val color = colorStringToInteger(serviceOptions.getString("notificationColor"))`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    body?.let { builder.setContentText(body) }`,
    after: `    body?.let { builder.setContentText(emphasizeNotificationLabels(it)) }\n    (bigText ?: body)?.let {\n      builder.setStyle(Notification.BigTextStyle().bigText(emphasizeNotificationLabels(it)))\n    }`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP\n      // We're defaulting to the behaviour prior API 31 (mutable) even though Android recommends immutability\n      val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0\n      val contentIntent = PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag)`,
    after: `      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP\n      notificationUrl?.let { url ->\n        it.action = Intent.ACTION_VIEW\n        it.data = Uri.parse(url)\n        it.addCategory(Intent.CATEGORY_BROWSABLE)\n      }\n      // We're defaulting to the behaviour prior API 31 (mutable) even though Android recommends immutability\n      val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0\n      val requestCode = notificationUrl?.hashCode() ?: 0\n      val contentIntent = PendingIntent.getActivity(this, requestCode, it, PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag)`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  private fun colorStringToInteger(color: String?): Int? {`,
    after: `  private fun emphasizeNotificationLabels(text: String): CharSequence {\n    val styled = SpannableStringBuilder(text)\n    listOf("Address", "Customer note", "Items").forEach { label ->\n      val start = text.indexOf(label)\n      if (start >= 0) {\n        styled.setSpan(\n          StyleSpan(Typeface.BOLD),\n          start,\n          start + label.length,\n          Spannable.SPAN_EXCLUSIVE_EXCLUSIVE\n        )\n      }\n    }\n    return styled\n  }\n\n  private fun colorStringToInteger(color: String?): Int? {`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setSmallIcon(iconsResId)\n      .build()`,
    after: `    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setOngoing(true)\n      .setOnlyAlertOnce(true)\n      .setSmallIcon(iconsResId)\n      .build()`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  companion object {\n    private var sServiceId = 481756`,
    after: `  companion object {\n    private var sServiceId = 481756\n    private val sActiveServices = ConcurrentHashMap<String, LocationTaskService>()\n\n    fun updateNotification(taskName: String, serviceOptions: Bundle): Boolean {\n      return sActiveServices[taskName]?.updateForeground(serviceOptions) ?: false\n    }`,
  },
];

const changedFiles = new Set();
for (const patch of patches) {
  const filePath = resolve(process.cwd(), patch.file);
  const source = readFileSync(filePath, 'utf8');
  if (source.includes(patch.after)) {
    continue;
  }
  if (!source.includes(patch.before)) {
    throw new Error(`Unsupported expo-location source while patching ${patch.file}`);
  }
  writeFileSync(filePath, source.replace(patch.before, patch.after));
  changedFiles.add(patch.file);
}

if (changedFiles.size > 0) {
  console.log(`Patched foreground notification behavior in ${changedFiles.size} expo-location files.`);
}

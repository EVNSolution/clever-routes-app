import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPPORTED_EXPO_LOCATION_VERSION = '56.0.24';
const expoLocationPackagePath = resolve(
  process.cwd(),
  'node_modules/expo-location/package.json',
);

let expoLocationPackage;
try {
  expoLocationPackage = JSON.parse(readFileSync(expoLocationPackagePath, 'utf8'));
} catch (error) {
  throw new Error(
    `Unable to verify installed expo-location package metadata at ${expoLocationPackagePath}`,
    { cause: error },
  );
}

if (
  expoLocationPackage?.name !== 'expo-location'
  || expoLocationPackage.version !== SUPPORTED_EXPO_LOCATION_VERSION
) {
  throw new Error(
    `Unsupported expo-location package metadata: expected expo-location@${SUPPORTED_EXPO_LOCATION_VERSION}`,
  );
}

const patches = [
  {
    file: 'node_modules/expo-location/expo-module.config.json',
    before: `  "android": {\n    "modules": ["expo.modules.location.LocationModule"],\n    "publication": {\n      "groupId": "host.exp.exponent",\n      "artifactId": "expo.modules.location",\n      "version": "${SUPPORTED_EXPO_LOCATION_VERSION}",\n      "repository": "local-maven-repo"\n    }\n  }`,
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
    satisfiedBy: `import android.graphics.Typeface`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `import android.content.pm.PackageManager\nimport android.graphics.Color\nimport android.graphics.Typeface`,
    after: `import android.content.pm.PackageManager\nimport android.content.res.Configuration\nimport android.graphics.Color\nimport android.graphics.Typeface`,
    satisfiedBy: `import android.content.res.Configuration`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `import android.text.style.StyleSpan\n\nclass LocationTaskService`,
    after: `import android.text.style.StyleSpan\nimport android.widget.RemoteViews\nimport java.util.concurrent.ConcurrentHashMap\n\nclass LocationTaskService`,
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
    before: `      builder.setContentIntent(contentIntent)\n    }\n\n    val iconsResId = try {`,
    after: `      builder.setContentIntent(contentIntent)\n    }\n\n    val notificationUri = notificationUrl?.let(Uri::parse)\n    if (notificationUri?.getQueryParameter("showStopActions") == "true") {\n      fun addStopAction(title: String, action: String): PendingIntent? {\n        return mParentContext.packageManager.getLaunchIntentForPackage(mParentContext.packageName)?.let {\n          val actionUri = notificationUri.buildUpon().appendQueryParameter("action", action).build()\n          it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP\n          it.action = Intent.ACTION_VIEW\n          it.data = actionUri\n          it.addCategory(Intent.CATEGORY_BROWSABLE)\n          val actionIntent = PendingIntent.getActivity(\n            this,\n            actionUri.toString().hashCode(),\n            it,\n            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE\n          )\n          builder.addAction(0, title, actionIntent)\n          actionIntent\n        }\n      }\n      val addProofIntent = addStopAction("Add Proof", "add_proof")\n      val nextStopIntent = addStopAction("Next Stop", "next_stop")\n      val compactLayoutId = resources.getIdentifier("clever_route_notification_actions", "layout", mParentContext.packageName)\n      val titleViewId = resources.getIdentifier("notification_title", "id", mParentContext.packageName)\n      val addProofViewId = resources.getIdentifier("notification_add_proof", "id", mParentContext.packageName)\n      val nextStopViewId = resources.getIdentifier("notification_next_stop", "id", mParentContext.packageName)\n      if (compactLayoutId != 0 && titleViewId != 0 && addProofViewId != 0 && nextStopViewId != 0 && addProofIntent != null && nextStopIntent != null) {\n        val compactView = RemoteViews(mParentContext.packageName, compactLayoutId)\n        compactView.setTextViewText(titleViewId, title)\n        compactView.setOnClickPendingIntent(addProofViewId, addProofIntent)\n        compactView.setOnClickPendingIntent(nextStopViewId, nextStopIntent)\n        builder.setCustomContentView(compactView)\n      }\n    }\n\n    val iconsResId = try {`,
    satisfiedBy: `val notificationUri = notificationUrl?.let(Uri::parse)`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `        val compactView = RemoteViews(mParentContext.packageName, compactLayoutId)\n        compactView.setTextViewText(titleViewId, title)`,
    after: `        val compactView = RemoteViews(mParentContext.packageName, compactLayoutId)\n        val compactTextColor = if (\n          resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES\n        ) Color.WHITE else Color.rgb(32, 33, 36)\n        compactView.setTextViewText(titleViewId, title)\n        compactView.setTextColor(titleViewId, compactTextColor)\n        compactView.setTextColor(addProofViewId, compactTextColor)\n        compactView.setTextColor(nextStopViewId, compactTextColor)`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  private fun colorStringToInteger(color: String?): Int? {`,
    after: `  private fun emphasizeNotificationLabels(text: String): CharSequence {\n    val styled = SpannableStringBuilder(text)\n    listOf("Address", "Customer note", "Items").forEach { label ->\n      val start = text.indexOf(label)\n      if (start >= 0) {\n        styled.setSpan(\n          StyleSpan(Typeface.BOLD),\n          start,\n          start + label.length,\n          Spannable.SPAN_EXCLUSIVE_EXCLUSIVE\n        )\n      }\n    }\n    return styled\n  }\n\n  private fun colorStringToInteger(color: String?): Int? {`,
    satisfiedBy: `val firstLineEnd = text.indexOf('\\n')`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `  private fun emphasizeNotificationLabels(text: String): CharSequence {\n    val styled = SpannableStringBuilder(text)\n    listOf("Address", "Customer note", "Items").forEach { label ->\n      val start = text.indexOf(label)\n      if (start >= 0) {\n        styled.setSpan(\n          StyleSpan(Typeface.BOLD),\n          start,\n          start + label.length,\n          Spannable.SPAN_EXCLUSIVE_EXCLUSIVE\n        )\n      }\n    }\n    return styled\n  }`,
    previous: `    listOf("Status", "Total").forEach { label ->`,
    previousAfter: `    listOf("Status", "Total", "Customer note", "Items").forEach { label ->`,
    after: `  private fun emphasizeNotificationLabels(text: String): CharSequence {\n    val styled = SpannableStringBuilder(text)\n    val firstLineEnd = text.indexOf('\\n')\n    if (firstLineEnd > 0) {\n      styled.setSpan(\n        StyleSpan(Typeface.BOLD),\n        0,\n        firstLineEnd,\n        Spannable.SPAN_EXCLUSIVE_EXCLUSIVE\n      )\n    }\n    listOf("Status", "Total", "Customer note", "Items").forEach { label ->\n      val start = text.indexOf(label)\n      if (start >= 0) {\n        styled.setSpan(\n          StyleSpan(Typeface.BOLD),\n          start,\n          start + label.length,\n          Spannable.SPAN_EXCLUSIVE_EXCLUSIVE\n        )\n      }\n    }\n    return styled\n  }`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setSmallIcon(iconsResId)\n      .build()`,
    after: `    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setOngoing(true)\n      .setOnlyAlertOnce(true)\n      .setSmallIcon(iconsResId)\n      .build()`,
    satisfiedBy: `.setPublicVersion(publicNotification)`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setOngoing(true)\n      .setOnlyAlertOnce(true)\n      .setSmallIcon(iconsResId)\n      .build()`,
    previous: `.setContentTitle("Clever Driver")`,
    previousAfter: `.setContentTitle("CLEVER Routes")`,
    after: `    val publicNotification = Notification.Builder(this, mChannelId)\n      .setCategory(Notification.CATEGORY_SERVICE)\n      .setContentTitle("CLEVER Routes")\n      .setContentText("Active route in progress")\n      .setOngoing(true)\n      .setOnlyAlertOnce(true)\n      .setSmallIcon(iconsResId)\n      .build()\n\n    return builder.setCategory(Notification.CATEGORY_SERVICE)\n      .setOngoing(true)\n      .setOnlyAlertOnce(true)\n      .setPublicVersion(publicNotification)\n      .setSmallIcon(iconsResId)\n      .setVisibility(Notification.VISIBILITY_PRIVATE)\n      .build()`,
  },
  {
    file: 'node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt',
    before: `    if (channel == null) {\n      channel = NotificationChannel(id, appName, NotificationManager.IMPORTANCE_LOW)\n      channel.description = "Background location notification channel"\n      notificationManager.createNotificationChannel(channel)\n    }`,
    after: `    if (channel == null) {\n      channel = NotificationChannel(id, appName, NotificationManager.IMPORTANCE_LOW)\n      channel.description = "Background location notification channel"\n    }\n    channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE\n    notificationManager.createNotificationChannel(channel)`,
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
  if (
    source.includes(patch.after)
    || (patch.satisfiedBy !== undefined && source.includes(patch.satisfiedBy))
  ) {
    continue;
  }
  const matchedSource = source.includes(patch.before)
    ? patch.before
    : patch.previous !== undefined && source.includes(patch.previous)
      ? patch.previous
      : null;
  if (matchedSource === null) {
    throw new Error(
      `Unsupported expo-location source while patching ${patch.file}: ${patch.before.slice(0, 80)}`,
    );
  }
  const replacement = matchedSource === patch.previous
    ? patch.previousAfter ?? patch.after
    : patch.after;
  writeFileSync(filePath, source.replace(matchedSource, replacement));
  changedFiles.add(patch.file);
}

if (changedFiles.size > 0) {
  console.log(`Patched foreground notification behavior in ${changedFiles.size} expo-location files.`);
}

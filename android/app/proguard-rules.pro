# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Expo TaskManager resolves this loader by the class name stored in AndroidManifest.xml.
# Keep the exact name and implementation so minified background location jobs can load JS.
-keep class expo.modules.adapters.react.apploader.RNHeadlessAppLoader { *; }

# Add any project specific keep options here:

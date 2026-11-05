const { withAppDelegate, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

// Notifications are local only (fed by the Mac's event stream), and a free Apple
// team can't sign the push entitlement expo-notifications adds.
const withoutPush = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });

// iOS 27 traps at launch unless the app adopts the scene life cycle. SDK 58 ships
// ExpoAppSceneDelegate for it, but its prebuild template still starts React Native
// from the app delegate's own window; hand that to the scene delegate instead.
const withSceneLifecycle = (config) =>
  withInfoPlist(
    withAppDelegate(config, (c) => {
      c.modResults.contents = c.modResults.contents
        .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
        .replace(/#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n/, '');
      return c;
    }),
    (c) => {
      c.modResults.UIApplicationSceneManifest = {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }],
        },
      };
      return c;
    },
  );

module.exports = {
  expo: {
    name: 'Luther',
    slug: 'luther',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'luther',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: 'dev.luther.app',
      appleTeamId: process.env.APPLE_TEAM_ID ?? '3BHPRL6PUQ',
      infoPlist: { NSSupportsLiveActivities: true },
    },
    android: {
      package: 'dev.luther.app',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      withoutPush,
      withSceneLifecycle,
      'expo-router',
      ['expo-splash-screen', { backgroundColor: '#000000', image: './assets/images/splash-icon.png', imageWidth: 76 }],
      'expo-secure-store',
      ['expo-camera', { cameraPermission: 'Luther uses the camera to scan the pairing code from your Mac.', microphonePermission: false, recordAudioAndroid: false }],
      'expo-notifications',
      'expo-widgets',
      'expo-background-task',
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
  },
};

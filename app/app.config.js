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

const MIC = "Luther listens while you hold the mic button, to type your message.";

module.exports = {
  expo: {
    name: 'Luther',
    slug: 'luther',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/luther-icon.png',
    scheme: 'luther',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/luther.icon',
      bundleIdentifier: 'dev.luther.app',
      appleTeamId: process.env.APPLE_TEAM_ID ?? '3BHPRL6PUQ',
      infoPlist: { NSSupportsLiveActivities: true },
    },
    android: {
      package: 'dev.luther.app',
      adaptiveIcon: {
        backgroundColor: '#086B64',
        foregroundImage: './assets/images/luther-android-foreground.png',
        monochromeImage: './assets/images/luther-android-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      withoutPush,
      withSceneLifecycle,
      'expo-router',
      ['expo-splash-screen', { backgroundColor: '#F2F5F4', image: './assets/images/luther-splash.png', imageWidth: 76, dark: { backgroundColor: '#101716', image: './assets/images/luther-splash-dark.png' } }],
      'expo-secure-store',
      ['expo-camera', { cameraPermission: 'Luther uses the camera to scan the pairing code from your Mac.', microphonePermission: MIC, recordAudioAndroid: false }],
      'expo-notifications',
      ['expo-image-picker', { photosPermission: 'Luther attaches the photos you pick to your message.', cameraPermission: 'Luther attaches the photos you take to your message.' }],
      'expo-document-picker',
      [
        'expo-widgets',
        {
          widgets: [
            { name: 'AgentsWidget', displayName: 'Agents', description: "What's running on your Mac, and your projects.", ios: { supportedFamilies: ['systemMedium', 'systemLarge'] }, android: null },
            { name: 'SendWidget', displayName: 'Send to Luther', description: 'A new task for an agent, one tap away.', ios: { supportedFamilies: ['systemSmall', 'accessoryCircular'] }, android: null },
          ],
        },
      ],
      'expo-quick-actions',
      ['expo-speech-recognition', { microphonePermission: MIC, speechRecognitionPermission: 'Luther turns what you say into your message, on this iPhone.' }],
      'expo-background-task',
    ],
    web: { favicon: './assets/images/luther-favicon.png' },
    // No React Compiler: the theme repaints one palette in place (components/ui.tsx),
    // which compiled components would keep cached in their old colours.
    experiments: { typedRoutes: true },
  },
};

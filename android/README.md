# GuardianLink Android

Kotlin + Jetpack Compose, minSdk 26. **Not compiled in the authoring sandbox** (no Android SDK/Gradle access) — open in Android Studio and build.

    ./gradlew assembleDebug -PSERVER_URL=https://your-server
    # release (signed): export GL_KEYSTORE=... GL_KS_PASS=... GL_KEY_ALIAS=... GL_KEY_PASS=... && ./gradlew assembleRelease -PSERVER_URL=...

Notes: server URL must be https. Usage-stats upload (`/api/device/usage`) is supported by the server but not yet implemented in the app (needs the user to grant Usage Access in Settings).

## Status (honest)
Build/test **not executed** in the authoring sandbox (no Android SDK; Google/Maven/Gradle hosts unreachable). Gradle wrapper 8.9 is included.
Needs: JDK 17, Android SDK 35 (`local.properties` with `sdk.dir=...`). Then:

    ./gradlew testDebugUnitTest assembleDebug -PSERVER_URL=http://10.0.2.2:3000   # emulator → local server (debug builds allow http only for 10.0.2.2/localhost)
    sha256sum app/build/outputs/apk/debug/app-debug.apk

Manual test checklist: join with valid code · reuse same code (must fail) · wrong/expired code · deny location permission · airplane-mode during enroll · parent revokes device (service stops on next tick) · Leave family · reboot (Android 14+ shows a "tap to resume" notice instead of auto-starting).

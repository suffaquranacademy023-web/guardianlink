plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.guardianlink.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.guardianlink.app"
        minSdk = 26; targetSdk = 35; versionCode = 4; versionName = "4.0.0"
        // Server URL comes from gradle.properties / -PSERVER_URL, never a secret.
        buildConfigField("String", "SERVER_URL", "\"${project.findProperty("SERVER_URL") ?: "https://example.invalid"}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    signingConfigs {
        create("release") {
            // Provide via env vars / CI secrets; never commit a keystore.
            val ks = System.getenv("GL_KEYSTORE")
            if (ks != null) { storeFile = file(ks); storePassword = System.getenv("GL_KS_PASS"); keyAlias = System.getenv("GL_KEY_ALIAS"); keyPassword = System.getenv("GL_KEY_PASS") }
        }
    }
    buildTypes { release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt")); if (System.getenv("GL_KEYSTORE") != null) signingConfig = signingConfigs.getByName("release") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // android.jar org.json is stubbed in JVM unit tests
}

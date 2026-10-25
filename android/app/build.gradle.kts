import java.util.Properties

// Build settings from local.properties (never committed). Builds carry the
// server address only - never an account token: everyone signs in. The
// release signing key lives outside the repo; without it, release builds
// fall back to the debug key (fine locally, but those can't update a
// published install).
//   hourglass.server=https://marobotic.dev/hourglass   (this is the default)
//   release.keystore=C:/Users/Maro/.marobotic/keys/marobotic-release.jks
//   release.storePassword=...  release.keyAlias=marobotic  release.keyPassword=...
val local = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("app.cash.paparazzi") // UI screenshots on the JVM: ./gradlew recordPaparazziDebug
}

android {
    namespace = "dev.marobotic.hourglass"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.marobotic.hourglass"
        minSdk = 26
        targetSdk = 35
        versionCode = 10
        versionName = "0.2.8"
        buildConfigField("String", "SERVER", "\"${local.getProperty("hourglass.server", "https://marobotic.dev/hourglass")}\"")
        // Where the app looks for a newer build (see Updates.kt).
        buildConfigField("String", "UPDATE_FEED", "\"https://marobotic.dev/apps/hourglass/latest.json\"")
    }

    signingConfigs {
        local.getProperty("release.keystore")?.takeIf { file(it).exists() }?.let { path ->
            create("release") {
                storeFile = file(path)
                storePassword = local.getProperty("release.storePassword")
                keyAlias = local.getProperty("release.keyAlias")
                keyPassword = local.getProperty("release.keyPassword")
            }
        }
    }

    buildTypes {
        // Every build is signed with the one marobotic release key when it is
        // here, debug builds too, so any build installs over any other.
        debug {
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        // Judge the UI on this build: R8-optimized Compose is far smoother than debug.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // real org.json; android.jar only has stubs
}

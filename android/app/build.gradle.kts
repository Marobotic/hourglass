import java.util.Properties

// Sync server and token come from local.properties (never committed), so a
// fresh install syncs with the droplet without typing a token on the phone.
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
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "SERVER", "\"${local.getProperty("hourglass.server", "")}\"")
        // Scrambled, not plain text; decoded once on first run and sealed with the Keystore.
        val salt = "dev.marobotic.hourglass"
        val tok = local.getProperty("hourglass.token", "").toByteArray()
        val scrambled = tok.mapIndexed { i, b -> "%02x".format((b.toInt() xor salt[i % salt.length].code) and 0xff) }.joinToString("")
        buildConfigField("String", "TOKEN_X", "\"$scrambled\"")
        buildConfigField("String", "TOKEN_SALT", "\"$salt\"")
    }

    buildTypes {
        // Judge the UI on this build: R8-optimized Compose is far smoother than
        // debug. Debug-signed so it installs over a debug build.
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("debug")
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

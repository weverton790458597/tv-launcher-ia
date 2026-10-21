plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.weverton.tvlauncher"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.weverton.tvlauncher"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // A interface web (assets/) e a configuração (config/) ficam fora do módulo Android,
    // exatamente como na estrutura do projeto, e são empacotadas dentro do APK.
    sourceSets["main"].assets.srcDirs("../../assets", "../../config")
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}

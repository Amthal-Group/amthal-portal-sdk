plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    `maven-publish`
}

android {
    namespace = "com.amthalgroup.portal"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    // Fragment/Activity types appear in the public API surface -> api scope.
    api(libs.androidx.appcompat)
    api(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.coroutines.android)
}

afterEvaluate {
    publishing {
        publications {
            register<MavenPublication>("release") {
                groupId = "com.amthalgroup"
                artifactId = "portal-sdk"
                version = "1.0.0"
                from(components["release"])
                pom {
                    name.set("Amthal Portal SDK")
                    description.set("Embeds the Amthal Client Portal (forms and other /embed/* surfaces) in Android apps via a hardened WebView and the Amthal Bridge Protocol v1.")
                }
            }
        }
        repositories {
            maven {
                name = "GitHubPackages"
                url = uri(
                    System.getenv("GITHUB_MAVEN_URL")
                        ?: "https://maven.pkg.github.com/amthal-group/portal-sdk"
                )
                credentials {
                    username = System.getenv("GITHUB_ACTOR") ?: ""
                    password = System.getenv("GITHUB_TOKEN") ?: ""
                }
            }
        }
    }
}

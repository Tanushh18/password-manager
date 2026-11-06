// Google's mirror of Maven Central first: Maven Central itself rate-limits busy shared networks (HTTP 429).
val centralMirror = "https://maven-central.storage-download.googleapis.com/maven2/"

pluginManagement {
    repositories {
        google()
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); maven(centralMirror); mavenCentral() }
}
rootProject.name = "StashrHub"
include(":app")

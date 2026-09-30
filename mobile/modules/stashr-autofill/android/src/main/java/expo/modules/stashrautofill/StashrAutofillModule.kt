package expo.modules.stashrautofill

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StashrAutofillModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("StashrAutofill")

    Function("isServiceEnabled") {
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
      val me = ComponentName(context, StashrAutofillService::class.java)
      enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    Function("openAccessibilitySettings") {
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("saveCredentials") { json: String ->
      CredentialStore.parse(json)
      CredentialStore.save(context, json)
    }

    Function("getPendingLinks") { CredentialStore.pendingLinksJson(context) }

    Function("ackPendingLinks") { json: String -> CredentialStore.ackPending(context, json) }

    Function("clearLinks") { CredentialStore.clearLinks(context) }

    Function("clearCredentials") { CredentialStore.clear(context) }

    Function("setRequireBiometric") { on: Boolean -> CredentialStore.setRequireBiometric(context, on) }
  }
}

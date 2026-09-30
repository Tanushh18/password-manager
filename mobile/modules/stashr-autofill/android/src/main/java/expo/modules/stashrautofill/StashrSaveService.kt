package expo.modules.stashrautofill

import android.app.assist.AssistStructure
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.widget.Toast
import androidx.annotation.RequiresApi
import java.util.UUID

/**
 * Android's autofill framework, used only for "Save password to Stashr?". The accessibility service
 * cannot see what is typed into a password field; this is the one place Android hands over the values.
 */
@RequiresApi(Build.VERSION_CODES.O)
class StashrSaveService : AutofillService() {
  private class Field(val id: AutofillId, val traits: FieldTraits, val text: String?)

  private class Form(val fields: List<Field>, val webDomain: String?, val pick: LoginPick)

  override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
    val structure = request.fillContexts.lastOrNull()?.structure
    val form = structure?.let { parse(it) }
    if (structure == null || form == null || structure.activityComponent?.packageName == packageName) {
      callback.onSuccess(null)
      return
    }
    val required = arrayOf(form.fields[form.pick.passwordIdx].id)
    val save = SaveInfo.Builder(
      if (form.pick.usernameIdx != null) SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD else SaveInfo.SAVE_DATA_TYPE_PASSWORD,
      required
    ).apply {
      form.pick.usernameIdx?.let { setOptionalIds(arrayOf(form.fields[it].id)) }
      setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
    }.build()
    callback.onSuccess(FillResponse.Builder().setSaveInfo(save).build())
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val structure = request.fillContexts.lastOrNull()?.structure
    val form = structure?.let { parse(it) }
    val password = form?.fields?.get(form.pick.passwordIdx)?.text.orEmpty()
    if (structure == null || form == null || password.isEmpty()) {
      callback.onSuccess()
      return
    }
    val username = form.pick.usernameIdx?.let { form.fields[it].text }.orEmpty().trim()
    val pkg = structure.activityComponent?.packageName.orEmpty()
    val host = form.webDomain?.lowercase()?.removePrefix("www.").orEmpty()

    val name: String
    val url: String
    val matchUrl: String?
    if (host.isNotEmpty()) {
      name = host
      url = host
      matchUrl = "https://$host"
    } else {
      name = appLabel(pkg).ifBlank { pkg }
      url = ""
      matchUrl = null
    }

    val all = CredentialStore.load(this)
    val existing = Matcher.match(all, pkg, if (host.isEmpty()) name else "", matchUrl)
      .firstOrNull { it.username.equals(username, ignoreCase = true) }
    if (existing == null || existing.password != password) {
      val isPending = existing?.id?.startsWith("pending:") == true
      val ref = if (isPending) existing!!.id.removePrefix("pending:") else UUID.randomUUID().toString()
      val realId = existing?.id?.takeUnless { it.startsWith("pending:") }
      CredentialStore.queueSave(
        this,
        Links.PendingSave(ref, realId, existing?.name ?: name, existing?.url ?: url, username, password)
      )
      Toast.makeText(this, "Saved in Stashr. Open Stashr to add it to your vault.", Toast.LENGTH_LONG).show()
    }
    callback.onSuccess()
  }

  private fun appLabel(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (e: Exception) {
    ""
  }

  private fun parse(structure: AssistStructure): Form? {
    val fields = mutableListOf<Field>()
    var domain: String? = null
    fun walk(node: AssistStructure.ViewNode) {
      if (domain == null) domain = node.webDomain
      val id = node.autofillId
      if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
        val hints = node.autofillHints?.map { it.lowercase() }.orEmpty()
        val attrs = node.htmlInfo?.attributes?.associate { it.first.lowercase() to it.second.lowercase() }.orEmpty()
        val variation = node.inputType and InputType.TYPE_MASK_VARIATION
        val textClass = node.inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT
        val isPassword = View.AUTOFILL_HINT_PASSWORD.lowercase() in hints || attrs["type"] == "password" ||
          (textClass && (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD))
        val idName = node.idEntry.orEmpty().lowercase()
        val userHint = hints.any { it in setOf("username", "emailaddress", "email") } ||
          attrs["type"] == "email" || listOf("user", "email", "login").any { idName.contains(it) }
        val text = node.autofillValue?.takeIf { it.isText }?.textValue?.toString()
        fields += Field(id, FieldTraits(isPassword, userHint), text)
      }
      for (i in 0 until node.childCount) walk(node.getChildAt(i))
    }
    for (w in 0 until structure.windowNodeCount) walk(structure.getWindowNodeAt(w).rootViewNode)
    val pick = LoginFields.pick(fields.map { it.traits }) ?: return null
    return Form(fields, domain, pick)
  }
}

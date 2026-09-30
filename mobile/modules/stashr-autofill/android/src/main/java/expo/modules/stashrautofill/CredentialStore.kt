package expo.modules.stashrautofill

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Vault snapshot for the autofill service, encrypted with a non-exportable Android Keystore key. */
object CredentialStore {
  private const val PREFS = "stashr_autofill"
  private const val K_DATA = "data"
  private const val K_LINKS = "links"
  private const val K_PENDING = "pending_links"
  private const val K_SAVES = "pending_saves"
  private const val K_BIO = "require_biometric"
  private const val ALIAS = "stashr_autofill_key"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun put(ctx: Context, name: String, text: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val blob = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    prefs(ctx).edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
  }

  private fun get(ctx: Context, name: String): String? {
    val stored = prefs(ctx).getString(name, null) ?: return null
    return try {
      val blob = Base64.decode(stored, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 0, 12))
      String(cipher.doFinal(blob, 12, blob.size - 12), Charsets.UTF_8)
    } catch (e: Exception) {
      null
    }
  }

  fun save(ctx: Context, json: String) = put(ctx, K_DATA, json)

  fun load(ctx: Context): List<Credential> {
    val text = get(ctx, K_DATA) ?: return emptyList()
    return try { parse(text) } catch (e: Exception) { emptyList() }
  }

  /** Logins the user has picked for a given app/site before. */
  fun linksFor(ctx: Context, siteKey: String): Set<String> =
    Links.parse(get(ctx, K_LINKS).orEmpty())[siteKey].orEmpty()

  /** Remembers the pick and queues it so the app can also fill the item's empty website field. */
  fun addLink(ctx: Context, siteKey: String, id: String) {
    val links = Links.parse(get(ctx, K_LINKS).orEmpty()).toMutableMap()
    links[siteKey] = links[siteKey].orEmpty() + id
    put(ctx, K_LINKS, Links.toJson(links))
    val pending = Links.parsePending(get(ctx, K_PENDING).orEmpty())
    if (pending.none { it.first == siteKey && it.second == id }) {
      put(ctx, K_PENDING, Links.pendingToJson(pending + (siteKey to id)))
    }
  }

  fun pendingLinksJson(ctx: Context): String = Links.pendingToJson(Links.parsePending(get(ctx, K_PENDING).orEmpty()))

  fun ackPending(ctx: Context, json: String) {
    val done = Links.parsePending(json).toSet()
    val left = Links.parsePending(get(ctx, K_PENDING).orEmpty()).filterNot { it in done }
    put(ctx, K_PENDING, Links.pendingToJson(left))
  }

  /** Queues a new/changed login and makes it fillable on this phone straight away. */
  fun queueSave(ctx: Context, save: Links.PendingSave) {
    val saves = Links.parseSaves(get(ctx, K_SAVES).orEmpty()).filterNot { it.ref == save.ref } + save
    put(ctx, K_SAVES, Links.savesToJson(saves))
    val localId = save.existingId ?: "pending:${save.ref}"
    val all = load(ctx)
    val cred = Credential(localId, save.name, save.username, save.password, save.url)
    val next = if (all.any { it.id == localId }) all.map { if (it.id == localId) cred else it } else all + cred
    put(ctx, K_DATA, Links.credentialsToJson(next))
  }

  fun pendingSavesJson(ctx: Context): String = get(ctx, K_SAVES) ?: "[]"

  fun ackSaves(ctx: Context, refsJson: String) {
    val done = try {
      val a = JSONArray(refsJson)
      (0 until a.length()).map { a.getString(it) }.toSet()
    } catch (e: Exception) {
      emptySet()
    }
    val left = Links.parseSaves(get(ctx, K_SAVES).orEmpty()).filterNot { it.ref in done }
    put(ctx, K_SAVES, Links.savesToJson(left))
  }

  fun clearLinks(ctx: Context) {
    prefs(ctx).edit().remove(K_LINKS).remove(K_PENDING).remove(K_SAVES).apply()
  }

  fun parse(json: String): List<Credential> {
    val arr = JSONArray(json)
    return (0 until arr.length()).map { i ->
      val o: JSONObject = arr.getJSONObject(i)
      Credential(
        id = o.optString("id"),
        name = o.optString("name"),
        username = o.optString("username"),
        password = o.optString("password"),
        url = o.optString("url"),
      )
    }
  }

  fun clear(ctx: Context) {
    prefs(ctx).edit().remove(K_DATA).apply()
  }

  fun setRequireBiometric(ctx: Context, on: Boolean) {
    prefs(ctx).edit().putBoolean(K_BIO, on).apply()
  }

  fun requireBiometric(ctx: Context): Boolean = prefs(ctx).getBoolean(K_BIO, true)
}

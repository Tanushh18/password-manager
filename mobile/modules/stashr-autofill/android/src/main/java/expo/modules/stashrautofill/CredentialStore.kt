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

  fun save(ctx: Context, json: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val blob = cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
    prefs(ctx).edit().putString(K_DATA, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
  }

  fun load(ctx: Context): List<Credential> {
    val stored = prefs(ctx).getString(K_DATA, null) ?: return emptyList()
    return try {
      val blob = Base64.decode(stored, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 0, 12))
      val text = String(cipher.doFinal(blob, 12, blob.size - 12), Charsets.UTF_8)
      parse(text)
    } catch (e: Exception) {
      emptyList()
    }
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

package expo.modules.stashrsms

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions.askForPermissionsWithPermissionsManager
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private val INBOX: Uri = Uri.parse("content://sms/inbox")

class StashrSmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
  private fun canRead() = granted(Manifest.permission.READ_SMS)

  private fun col(c: Cursor, name: String): Int = c.getColumnIndex(name)
  private fun str(c: Cursor, i: Int): String? = if (i < 0 || c.isNull(i)) null else c.getString(i)
  private fun lng(c: Cursor, i: Int): Long = if (i < 0 || c.isNull(i)) 0L else c.getLong(i)

  override fun definition() = ModuleDefinition {
    Name("StashrSms")

    // Both permissions the feature uses: READ_SMS (the inbox) and RECEIVE_SMS (the arrival note).
    Function("hasPermission") {
      canRead() && granted(Manifest.permission.RECEIVE_SMS)
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      askForPermissionsWithPermissionsManager(
        appContext.permissions,
        object : Promise {
          override fun resolve(value: Any?) {
            promise.resolve(if (value is Bundle) value.getBoolean(PermissionsResponse.GRANTED_KEY) else value)
          }
          override fun reject(code: String?, message: String?, cause: Throwable?) = promise.reject(code, message, cause)
        },
        Manifest.permission.READ_SMS,
        Manifest.permission.RECEIVE_SMS
      )
    }

    // Messages from the inbox whose sender or text matches `match`, dated sinceMs or later, oldest first.
    AsyncFunction("readBankSms") { sinceMs: Double, limit: Int, match: String ->
      if (!canRead()) throw CodedException("E_SMS_PERMISSION", "Allow Stashr to read SMS first.", null)
      val since = SmsFilter.sinceOf(sinceMs)
      val max = SmsFilter.limitOf(limit)
      val pattern = SmsFilter.compile(match)
      val out = ArrayList<Map<String, Any>>()
      val cursor = context.contentResolver.query(INBOX, arrayOf("address", "body", "date"), "date >= ?", arrayOf(since.toString()), "date ASC")
      cursor?.use { c ->
        val ia = col(c, "address"); val ib = col(c, "body"); val id = col(c, "date")
        while (c.moveToNext() && out.size < max) {
          val date = lng(c, id)
          if (date < since) continue                               // belt and braces: never anything older
          val address = str(c, ia)
          val body = str(c, ib)
          if (!SmsFilter.matches(pattern, address, body)) continue
          out.add(mapOf("address" to (address ?: ""), "body" to SmsFilter.cut(body), "date" to date.toDouble()))
        }
      }
      out
    }

    // The date of the newest matching message, or null; looks at no more than the 200 newest rows.
    Function("getNewestBankSmsDate") { match: String ->
      if (!canRead()) throw CodedException("E_SMS_PERMISSION", "Allow Stashr to read SMS first.", null)
      val pattern = SmsFilter.compile(match)
      var newest: Double? = null
      val cursor = context.contentResolver.query(INBOX, arrayOf("address", "body", "date"), null, null, "date DESC")
      cursor?.use { c ->
        val ia = col(c, "address"); val ib = col(c, "body"); val id = col(c, "date")
        var seen = 0
        while (newest == null && seen < 200 && c.moveToNext()) {
          seen++
          if (SmsFilter.matches(pattern, str(c, ia), str(c, ib))) newest = lng(c, id).toDouble()
        }
      }
      newest
    }

    // When the receiver last saw a bank message arrive (ms), 0 when it never has.
    Function("getLastArrival") {
      context.getSharedPreferences(SmsArrivalReceiver.PREFS, Context.MODE_PRIVATE).getLong(SmsArrivalReceiver.KEY_ARRIVAL, 0L).toDouble()
    }

    // True when something may have arrived after lastSeenMs. Unknown (never recorded) counts as "maybe", so nothing is missed.
    Function("hasNewSince") { lastSeenMs: Double ->
      val arrival = context.getSharedPreferences(SmsArrivalReceiver.PREFS, Context.MODE_PRIVATE).getLong(SmsArrivalReceiver.KEY_ARRIVAL, 0L)
      SmsFilter.newSince(arrival, SmsFilter.sinceOf(lastSeenMs))
    }

    // Which messages the arrival note looks for (same rule as `match`).
    Function("setArrivalMatch") { match: String ->
      context.getSharedPreferences(SmsArrivalReceiver.PREFS, Context.MODE_PRIVATE).edit().putString(SmsArrivalReceiver.KEY_MATCH, match.take(200)).apply()
    }
  }
}

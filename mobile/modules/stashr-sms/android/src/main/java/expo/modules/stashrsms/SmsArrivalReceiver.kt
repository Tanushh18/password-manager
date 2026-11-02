package expo.modules.stashrsms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Records the time a bank message arrived (and nothing else) so the app can skip a full inbox read when nothing is new. */
class SmsArrivalReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    try {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val pattern = SmsFilter.compile(prefs.getString(KEY_MATCH, null))
      val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      // A long message arrives in parts: join the parts of one sender before looking.
      val bySender = LinkedHashMap<String, StringBuilder>()
      for (m in messages) bySender.getOrPut(m.originatingAddress ?: "") { StringBuilder() }.append(m.messageBody ?: "")
      if (bySender.any { (address, body) -> SmsFilter.matches(pattern, address, body.toString()) }) {
        prefs.edit().putLong(KEY_ARRIVAL, System.currentTimeMillis()).apply()
      }
    } catch (e: Exception) {
      // never let a malformed broadcast crash the app
    }
  }

  companion object {
    const val PREFS = "stashr_sms"
    const val KEY_ARRIVAL = "lastBankSmsArrival"
    const val KEY_MATCH = "arrivalMatch"
  }
}

package expo.modules.stashrsms

import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

/** The pure rules for which messages count as "bank" messages and how they are trimmed; no Android classes, so it is unit-tested. */
object SmsFilter {
  const val DEFAULT_MATCH = "fed"
  const val MAX_BODY = 600
  const val DEFAULT_LIMIT = 500
  const val MAX_LIMIT = 2000

  /** A case-insensitive regex; text that is not a valid regex is searched for literally. Blank means the default. */
  fun compile(match: String?): Pattern {
    val text = if (match.isNullOrBlank()) DEFAULT_MATCH else match.trim().take(200)
    return try {
      Pattern.compile(text, Pattern.CASE_INSENSITIVE)
    } catch (e: PatternSyntaxException) {
      Pattern.compile(Pattern.quote(text), Pattern.CASE_INSENSITIVE)
    }
  }

  /** True when the sender or the text contains the pattern. Null parts never throw. */
  fun matches(pattern: Pattern, address: String?, body: String?): Boolean =
    (address != null && pattern.matcher(address).find()) || (body != null && pattern.matcher(body).find())

  fun cut(body: String?): String = (body ?: "").let { if (it.length > MAX_BODY) it.substring(0, MAX_BODY) else it }

  fun limitOf(limit: Int?): Int = when {
    limit == null || limit <= 0 -> DEFAULT_LIMIT
    limit > MAX_LIMIT -> MAX_LIMIT
    else -> limit
  }

  /** Never below zero; the query itself also says `date >= since`, so nothing older than this is ever read. */
  fun sinceOf(sinceMs: Double): Long = if (sinceMs.isNaN() || sinceMs < 0) 0L else sinceMs.toLong()

  /** The newest-arrival marker is unknown (0) -> callers must assume something may have arrived. */
  fun newSince(arrival: Long, lastSeenMs: Long): Boolean = arrival == 0L || arrival > lastSeenMs
}

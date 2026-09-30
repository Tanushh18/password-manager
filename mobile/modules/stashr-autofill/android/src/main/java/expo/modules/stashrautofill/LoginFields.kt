package expo.modules.stashrautofill

/** What we can tell about one text field on screen, in screen order. */
data class FieldTraits(val isPassword: Boolean, val userHint: Boolean)

data class LoginPick(val passwordIdx: Int, val usernameIdx: Int?)

object LoginFields {
  /** Finds the password field (the new one on change-password screens) and the username field before it. */
  fun pick(fields: List<FieldTraits>): LoginPick? {
    val passwords = fields.indices.filter { fields[it].isPassword }
    if (passwords.isEmpty()) return null
    val p = if (passwords.size >= 3) passwords[1] else passwords[0]
    val before = (0 until p).filter { !fields[it].isPassword }
    val user = before.lastOrNull { fields[it].userHint } ?: before.lastOrNull()?.takeIf { it == p - 1 }
    return LoginPick(p, user)
  }
}

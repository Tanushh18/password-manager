package expo.modules.stashrautofill

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/** Transparent host for the system biometric prompt, used to confirm before a login is filled. */
class AuthActivity : FragmentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val prompt = BiometricPrompt(
      this,
      ContextCompat.getMainExecutor(this),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = finishWith(true)
        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = finishWith(false)
      }
    )
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Fill with Stashr")
      .setSubtitle("Confirm it's you to fill this login")
      .setAllowedAuthenticators(allowedAuthenticators())
      .apply { if (allowedAuthenticators() and DEVICE_CREDENTIAL == 0) setNegativeButtonText("Cancel") }
      .build()
    prompt.authenticate(info)
  }

  private fun finishWith(ok: Boolean) {
    pending?.invoke(ok)
    pending = null
    finish()
  }

  companion object {
    private var pending: ((Boolean) -> Unit)? = null

    fun allowedAuthenticators(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_WEAK

    /** No screen lock or biometric on the device means there is nothing to confirm with. */
    fun canPrompt(ctx: Context): Boolean =
      BiometricManager.from(ctx).canAuthenticate(allowedAuthenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    fun request(ctx: Context, onResult: (Boolean) -> Unit) {
      pending = onResult
      ctx.startActivity(Intent(ctx, AuthActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}

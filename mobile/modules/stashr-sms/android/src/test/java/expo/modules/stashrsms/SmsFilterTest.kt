package expo.modules.stashrsms

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsFilterTest {
  private val sample = "Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75. Not you?Call 18004251199 -Federal Bank"

  @Test fun defaultMatchFindsFederalBankInTheBodyOrTheSender() {
    val p = SmsFilter.compile(null)
    assertTrue(SmsFilter.matches(p, "+919800000000", sample))
    assertTrue(SmsFilter.matches(p, "VM-FEDBNK-S", "Your OTP is 123"))
    assertFalse(SmsFilter.matches(p, "AX-HDFCBK", "Rs 10 debited"))
  }

  @Test fun nullPartsNeverThrow() {
    val p = SmsFilter.compile("fed")
    assertFalse(SmsFilter.matches(p, null, null))
    assertTrue(SmsFilter.matches(p, null, sample))
  }

  @Test fun anInvalidRegexIsSearchedForLiterally() {
    val p = SmsFilter.compile("a/c [X")
    assertTrue(SmsFilter.matches(p, null, "from a/c [X9229"))
    assertFalse(SmsFilter.matches(p, null, "from a/c X9229"))
  }

  @Test fun bodiesAreCutAndLimitsClamped() {
    assertEquals(600, SmsFilter.cut("x".repeat(900)).length)
    assertEquals("", SmsFilter.cut(null))
    assertEquals(500, SmsFilter.limitOf(null))
    assertEquals(500, SmsFilter.limitOf(0))
    assertEquals(2000, SmsFilter.limitOf(99999))
    assertEquals(25, SmsFilter.limitOf(25))
  }

  @Test fun sinceIsNeverNegative() {
    assertEquals(0L, SmsFilter.sinceOf(-5.0))
    assertEquals(0L, SmsFilter.sinceOf(Double.NaN))
    assertEquals(1700000000000L, SmsFilter.sinceOf(1.7e12))
  }

  @Test fun unknownArrivalCountsAsMaybeNew() {
    assertTrue(SmsFilter.newSince(0L, 100L))
    assertTrue(SmsFilter.newSince(200L, 100L))
    assertFalse(SmsFilter.newSince(100L, 100L))
    assertFalse(SmsFilter.newSince(50L, 100L))
  }
}

import { Language } from '../domain/triage.js';
import { RefundOutcome, RefundReason } from '../domain/refund-policy.js';

/**
 * The model writes the empathy. This writes the money.
 *
 * Every sentence below is a template keyed on the gate's reason code, so the
 * claim a user reads about their payment is generated from the same decision
 * the gate made -- it cannot drift from it, and no ticket text reaches it.
 *
 * This is also why reply_draft is safe to send after a prompt injection: the
 * money sentence is chosen by rule_id, not by anything the model produced.
 */

type Phrases = Record<RefundReason, string>;

const EN: Phrases = {
  FRAUD_CLAIM_NEEDS_IDENTITY_CHECK:
    'Because this involves charges you say were not authorised, a member of our team will review the account directly and contact you today. Please do not share card or UPI details in your reply.',
  NO_CAPTURED_PAYMENT:
    'Our records show no completed payment on this account, so there is nothing for us to reverse.',
  CLAIMED_CHARGE_NEVER_CAPTURED:
    'That payment is showing as incomplete on our side, which means it has not reached us. If your bank has placed a hold, it is normally released within 5-7 working days. Our billing team is checking the account and will confirm.',
  NOT_A_DUPLICATE_ONE_CAPTURE_ONLY:
    'We checked the account: one payment completed and an earlier attempt failed. A failed attempt can show on a bank statement and then drop off, which is usually what a second entry turns out to be. Only one payment reached us.',
  DUPLICATE_CAPTURE_CONFIRMED:
    'We can see two payments for the same plan on the account. We are reversing the second one, and it should reach you within 5-7 working days.',
  REMORSE_WINDOW_UNUSED:
    'We are reversing this payment in full. It should reach the account it came from within 5-7 working days.',
  OUTSIDE_REMORSE_WINDOW:
    'This payment falls outside the window we can reverse automatically, so a member of our team will review it and come back to you.',
  SERVICE_USED_SUBSTANTIALLY:
    'The plan has been used since this payment, so a member of our team will review the request and come back to you.',
  CANCELLATION_NO_REFUND_DUE:
    'Your plan will not renew again. You keep access until the current period ends, and there is nothing further to pay.',
  NO_BILLING_CLAIM: '',
};

/** Romanised Hindi, to match a user who wrote in Latin script. */
const HINGLISH: Phrases = {
  FRAUD_CLAIM_NEEDS_IDENTITY_CHECK:
    'Kyunki yeh un charges ke baare mein hai jo aapke mutabik authorise nahi kiye gaye, humari team account ko khud review karke aaj hi aapse contact karegi. Reply mein card ya UPI details share na karein.',
  NO_CAPTURED_PAYMENT:
    'Humare records mein is account par koi complete payment nahi hai, isliye reverse karne ke liye kuch hai hi nahi.',
  CLAIMED_CHARGE_NEVER_CAPTURED:
    'Woh payment humare system mein incomplete dikh raha hai, matlab woh hum tak nahi pahuncha. Agar aapke bank ne hold lagaya hai to woh aam taur par 5-7 working days mein release ho jaata hai. Humari billing team account check kar rahi hai aur aapko confirm karegi.',
  NOT_A_DUPLICATE_ONE_CAPTURE_ONLY:
    'Humne account check kiya: ek payment complete hua aur ek pehle ki koshish fail hui thi. Fail hui koshish bank statement par dikh kar baad mein hat jaati hai, aksar doosri entry wahi hoti hai. Hum tak sirf ek hi payment aaya hai.',
  DUPLICATE_CAPTURE_CONFIRMED:
    'Account par ek hi plan ke do payment dikh rahe hain. Hum doosra wala reverse kar rahe hain, 5-7 working days mein aa jana chahiye.',
  REMORSE_WINDOW_UNUSED:
    'Hum yeh payment poora reverse kar rahe hain. Jis account se gaya tha usi mein 5-7 working days mein aa jana chahiye.',
  OUTSIDE_REMORSE_WINDOW:
    'Yeh payment us window ke bahar hai jise hum automatically reverse kar sakte hain, isliye humari team ise review karke aapko batayegi.',
  SERVICE_USED_SUBSTANTIALLY:
    'Is payment ke baad plan use hua hai, isliye humari team request review karke aapko batayegi.',
  CANCELLATION_NO_REFUND_DUE:
    'Aapka plan dobara renew nahi hoga. Current period khatam hone tak access rahega, aur aage kuch pay nahi karna hai.',
  NO_BILLING_CLAIM: '',
};

function phrasesFor(language: Language): Phrases {
  return language === 'hinglish' || language === 'hi' ? HINGLISH : EN;
}

/**
 * Appends the money sentence to the model's draft.
 *
 * Amounts are interpolated from the gate's outcome, never from the model.
 */
export function assembleReply(
  modelBody: string,
  refund: RefundOutcome,
  language: Language,
): string {
  const sentence = phrasesFor(language)[refund.reason];
  if (!sentence) return modelBody.trim();

  const withAmount =
    refund.decision === 'refund' && refund.amount_inr > 0
      ? sentence.replace(
          /(reversing (?:this payment in full|the second one)|reverse kar rahe hain)/,
          (m) => `${m} (₹${refund.amount_inr})`,
        )
      : sentence;

  return `${modelBody.trim()}\n\n${withAmount}`;
}

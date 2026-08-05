/**
 * One place that turns a backend `tallyPush` result into what the user is told.
 *
 * The create screens each rolled their own version of this and all five shared
 * the same blind spot: they handled 'completed' and 'failed' but let every other
 * status — including the backend's default 'skipped' — fall through to a plain
 * "Saved". A record that never went near Tally looked identical to one that
 * synced, which is how "it says created but it's not in Tally" happened.
 *
 * Rule: never imply something reached Tally unless Tally confirmed it.
 */
export type TallyPushResultLike =
  | {
      status?: string;
      message?: string;
      voucherNumber?: string;
      /** Backend queued it in tallyimportqueue for replay on agent reconnect. */
      queuedForRetry?: boolean;
    }
  | null
  | undefined;

export interface TallyPushMessage {
  title: string;
  message: string;
  /** True when the record is NOT in Tally — callers may want to draw attention. */
  needsAttention: boolean;
}

/**
 * @param push        the `tallyPush` object from the create response
 * @param entityLabel human name, e.g. "Sales invoice", "Ledger", "Stock item"
 * @param expectsPush false for records that are intentionally cloud-only
 */
export function describeTallyPush(
  push: TallyPushResultLike,
  entityLabel: string,
  expectsPush = true
): TallyPushMessage {
  const status = push?.status;

  if (status === 'completed' || status === 'already_synced') {
    const where = status === 'already_synced' ? 'already in Tally' : 'sent to Tally';
    const ref = push?.voucherNumber ? `\n\nTally voucher: ${push.voucherNumber}` : '';
    return {
      title: 'Saved & synced',
      message: `${entityLabel} saved and ${where}.${ref}`,
      needsAttention: false,
    };
  }

  if (status === 'failed') {
    const reason = push?.message || 'Desktop agent may be offline.';
    if (push?.queuedForRetry) {
      return {
        title: 'Saved — waiting for Tally',
        message:
          `${entityLabel} is saved, but it has NOT reached Tally yet.\n\n` +
          `It is queued and will sync automatically the next time the desktop ` +
          `agent connects. No need to create it again.\n\nReason: ${reason}`,
        needsAttention: true,
      };
    }
    return {
      title: 'Saved — NOT in Tally',
      message:
        `${entityLabel} is saved in the cloud but did not reach Tally, and it ` +
        `could not be queued for retry.\n\nReason: ${reason}`,
      needsAttention: true,
    };
  }

  if (!expectsPush) {
    return {
      title: 'Saved',
      message: `${entityLabel} saved.`,
      needsAttention: false,
    };
  }

  // 'skipped', undefined, or anything unrecognised. Previously silent.
  const reason = push?.message || 'It was not sent to Tally.';
  return {
    title: 'Saved — not sent to Tally',
    message:
      `${entityLabel} is saved in the cloud only.\n\n${reason}`,
    needsAttention: true,
  };
}

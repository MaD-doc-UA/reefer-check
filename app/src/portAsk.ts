// The question when a plan for another port arrives (file or QR): close the open port on this phone or not.

/** 'close' = archive and clear the marks of `from`, 'keep' = open the plan and keep the marks, null = cancel. */
export function askPortChange(ch: { from: string; to: string }): 'close' | 'keep' | null {
  if (confirm(
    `New port: ${ch.to} (this phone is on ${ch.from}).\n\n` +
    `OK = close ${ch.from} on this phone: its marks and log go to the archive (Plan tab), ` +
    `reefers still on board stay connected, with their tags and notes.\n\nCancel = other choices.`,
  )) return 'close';
  if (confirm(`Open the ${ch.to} plan and keep the ${ch.from} marks as they are (same port call)?\n\nCancel = do not open the plan.`)) return 'keep';
  return null;
}

/** Name field: uncontrolled (no value written back while typing) and no autocorrect.
 *  iPhone (WhatsApp in-app browser) lost the second word: autocorrect replaced the word on space
 *  while the controlled value was being re-set. */
export const NAME_INPUT = {
  type: 'text', maxLength: 60, placeholder: 'e.g. ETO Andrii Petrenko',
  autocomplete: 'off', autocapitalize: 'words', spellcheck: false, enterkeyhint: 'done',
  // set as an attribute: newer browsers have a boolean `autocorrect` property, where 'off' would read as true
  ref: (el: HTMLInputElement | null) => el?.setAttribute('autocorrect', 'off'),
} as const;

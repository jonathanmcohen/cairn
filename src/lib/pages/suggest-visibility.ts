/**
 * v0.10.3 Q-5 — when to surface the "Suggest edits" chip.
 *
 * The chip is the collaborative-review affordance: proposing tracked changes
 * for someone else to accept. On a page you own that is still a private
 * `draft`, suggesting edits to yourself is noise — you can just type. Once the
 * page leaves draft (submitted for review, published, archived) or you don't
 * own it, the chip is meaningful again.
 *
 * NOTE on the owner signal: ownership is taken as `pages.created_by` (the same
 * proxy `lib/pages/approval.ts` uses for the self-approval guard). A transfer
 * of the ACL owner tier does not move `created_by`, so the chip's visibility
 * follows the original author — acceptable for a cosmetic surface; it never
 * affects who *can* suggest, only whether the shortcut chip is shown.
 *
 * Cairn never assigned named reviewers to a page (the approval flow lets any
 * admin decide), so the original audit's "no reviewer assignments" condition
 * maps to "this is still a private owned draft".
 */
export function shouldShowSuggestEdits(input: { isOwner: boolean; status: string }): boolean {
  return !(input.isOwner && input.status === 'draft');
}

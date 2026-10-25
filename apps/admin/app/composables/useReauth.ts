import { ProfileReauthModal } from '#components'

/** How a question for the password ended. */
export type ReauthOutcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  /** The action was refused for a reason other than the password (a weak new password, a taken address): the page says where. */
  | { status: 'failed'; error: ApiRequestError }

export interface ReauthQuestion {
  title: string
  description: string
  confirmLabel: string
  color?: 'primary' | 'error'
  /** Runs with the password; throws the ApiRequestError of a refusal. */
  action: (password: string) => Promise<unknown>
}

/**
 * The one way the profile asks for the current password (the API wants it in the body of each call that proves the owner: new
 * password, e-mail change, removing a factor, new recovery codes). `ask()` opens the dialog, which runs the action itself and keeps
 * trying until the password is right or the person gives up. Call it synchronously in setup.
 */
export function useReauth() {
  const overlay = useOverlay()
  const dialog = overlay.create(ProfileReauthModal)
  const closed = useOverlayClosed()

  async function ask(question: ReauthQuestion): Promise<ReauthOutcome> {
    const outcome = (await dialog.open(question)) as ReauthOutcome | undefined
    // The caller moves focus next (to a field, or to the opener): it can only do that once the dialog has left.
    await closed(dialog.id)
    return outcome ?? { status: 'cancelled' }
  }

  return { ask }
}

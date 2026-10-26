// Who may do what with one content item: WordPress' `map_meta_cap()` for `read_post`, `edit_post`, `delete_post` and
// `publish_post` (wp-includes/capabilities.php), with the type's own capabilities (`edit_pages` for a page, `edit_posts` for a
// post). The meta capabilities are never stored; they are worked out here from the stored ones of the account's roles. With
// several authors (K-066), every author counts as the item's own author.
import type { ContentPermissions, ContentStatus, ContentStatusBeforeTrash, ContentTypeKey } from '@toascribe/shared'

/** The facts about an item the rules look at. */
export interface AccessItem {
  readonly type: ContentTypeKey
  readonly status: ContentStatus
  readonly statusBeforeTrash: ContentStatusBeforeTrash | null
  readonly authorIds: readonly string[]
}

/** The account asking: its id and the union of its roles' capabilities. */
export interface Actor {
  readonly id: string
  readonly capabilities: ReadonlySet<string>
}

/** The stored capabilities of a type: `edit_posts`, `edit_others_posts`, ... for posts, `edit_pages`, ... for pages. */
export function typeCapabilities(type: ContentTypeKey) {
  const plural = type === 'page' ? 'pages' : 'posts'
  return {
    edit: `edit_${plural}`,
    editOthers: `edit_others_${plural}`,
    editPublished: `edit_published_${plural}`,
    editPrivate: `edit_private_${plural}`,
    publish: `publish_${plural}`,
    delete: `delete_${plural}`,
    deleteOthers: `delete_others_${plural}`,
    deletePublished: `delete_published_${plural}`,
    deletePrivate: `delete_private_${plural}`,
    readPrivate: `read_private_${plural}`,
  } as const
}

const PUBLISHED: readonly string[] = ['publish', 'future']

function isOwn(item: AccessItem, actor: Actor): boolean {
  return item.authorIds.includes(actor.id)
}

function holdsAll(actor: Actor, capabilities: readonly string[]): boolean {
  return capabilities.every((capability) => actor.capabilities.has(capability))
}

/** Whether the account may see the type's list and make items of it (WordPress' edit.php and post-new.php). */
export function canEditType(actor: Actor, type: ContentTypeKey): boolean {
  return actor.capabilities.has(typeCapabilities(type).edit)
}

/** WordPress' `publish_posts` / `publish_pages`: needed to publish, schedule or make private. */
export function canPublishType(actor: Actor, type: ContentTypeKey): boolean {
  return actor.capabilities.has(typeCapabilities(type).publish)
}

/** May set the authors of the type's items (and, with publishing, make a post sticky): `edit_others_*`. */
export function canEditOthersType(actor: Actor, type: ContentTypeKey): boolean {
  return actor.capabilities.has(typeCapabilities(type).editOthers)
}

/**
 * `edit_post`. Own item: `edit_published_*` once it is published or scheduled (also while it is in the trash after being so),
 * `edit_*` otherwise. Someone else's: `edit_others_*`, and `edit_published_*` when it is published or scheduled, `edit_private_*`
 * when it is private.
 */
export function canEdit(actor: Actor, item: AccessItem): boolean {
  const caps = typeCapabilities(item.type)
  if (isOwn(item, actor)) {
    const wasPublished =
      PUBLISHED.includes(item.status) ||
      (item.status === 'trash' && item.statusBeforeTrash !== null && PUBLISHED.includes(item.statusBeforeTrash))
    return holdsAll(actor, [wasPublished ? caps.editPublished : caps.edit])
  }
  const needed: string[] = [caps.editOthers]
  if (PUBLISHED.includes(item.status)) {
    needed.push(caps.editPublished)
  } else if (item.status === 'private') {
    needed.push(caps.editPrivate)
  }
  return holdsAll(actor, needed)
}

/** `delete_post`: the same shape as `edit_post`, with the `delete_*` capabilities. */
export function canDelete(actor: Actor, item: AccessItem): boolean {
  const caps = typeCapabilities(item.type)
  if (isOwn(item, actor)) {
    const wasPublished =
      PUBLISHED.includes(item.status) ||
      (item.status === 'trash' && item.statusBeforeTrash !== null && PUBLISHED.includes(item.statusBeforeTrash))
    return holdsAll(actor, [wasPublished ? caps.deletePublished : caps.delete])
  }
  const needed: string[] = [caps.deleteOthers]
  if (PUBLISHED.includes(item.status)) {
    needed.push(caps.deletePublished)
  } else if (item.status === 'private') {
    needed.push(caps.deletePrivate)
  }
  return holdsAll(actor, needed)
}

/**
 * `read_post` for the admin: a published item can be read by anyone who may edit the type; a private one by its authors and by
 * `read_private_*`; a draft, a pending, a scheduled or a trashed one only by someone who may edit it.
 */
export function canRead(actor: Actor, item: AccessItem): boolean {
  if (!canEditType(actor, item.type)) {
    return false
  }
  if (item.status === 'publish') {
    return true
  }
  if (item.status === 'private') {
    return isOwn(item, actor) || actor.capabilities.has(typeCapabilities(item.type).readPrivate)
  }
  return canEdit(actor, item)
}

/** What the admin may offer for an item. */
export function permissionsFor(actor: Actor, item: AccessItem): ContentPermissions {
  return {
    edit: canEdit(actor, item),
    delete: canDelete(actor, item),
    publish: canPublishType(actor, item.type),
    editOthers: canEditOthersType(actor, item.type),
  }
}

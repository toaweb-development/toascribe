import type { AdminMenuEntry, AdminMenuEntryChild } from '@toascribe/shared'
import type { NavigationMenuItem } from '@nuxt/ui'

// The api's menu (`GET /api/v1/admin/menu`) as `UNavigationMenu` items. The api decides what is in the menu and in which order;
// this only adds the text (from the label key), the active state (from the route) and which sections start open.

/** True when `current` is the page `to` or a page below it. The start page (`/`) matches itself only. */
export function isOnPath(current: string, to: string): boolean {
  const path = current.split(/[?#]/, 1)[0] ?? ''
  const trimmed = to.length > 1 ? to.replace(/\/+$/, '') : to
  const here = path.length > 1 ? path.replace(/\/+$/, '') : path
  return trimmed === '/' ? here === '/' : here === trimmed || here.startsWith(`${trimmed}/`)
}

/** The section the page belongs to: the item whose own path or one of whose sub-items' paths the page is. */
export function sectionOf(entries: readonly AdminMenuEntry[], current: string): string | undefined {
  // A sub-item wins over a parent that merely shares a prefix (`/users` is a parent of `/users/new` but `/profile` is not).
  const byChild = entries.find((entry) => entry.children.some((child) => isOnPath(current, child.to)))
  return (byChild ?? entries.find((entry) => isOnPath(current, entry.to)))?.id
}

type Label = (key: string) => string

function childItem(child: AdminMenuEntryChild, current: string, label: Label): NavigationMenuItem {
  return {
    label: label(child.labelKey),
    ...(child.icon === undefined ? {} : { icon: child.icon }),
    to: child.to,
    active: isOnPath(current, child.to),
    value: child.id,
  }
}

/** Indents a sub-item under its section in the expanded sidebar. */
const SUB_ITEM_CLASS = 'ms-6'

/**
 * `current` is the router path (`/profile`). The sidebar is either expanded or a collapsed icon rail:
 * - expanded: a section is its link, and its sub-items follow it as links of their own, indented, all showing (the api gives few,
 *   and Nuxt UI's accordion for them is a `span` with `aria-expanded` and no role, which axe rejects, and nothing a keyboard can open);
 * - collapsed: a section with sub-items keeps them as `children`, which open in a popover beside the rail.
 */
export function toNavigationItems(
  entries: readonly AdminMenuEntry[],
  current: string,
  label: Label,
  collapsed = false,
): NavigationMenuItem[] {
  const section = sectionOf(entries, current)
  return entries.flatMap((entry): NavigationMenuItem[] => {
    const parent: NavigationMenuItem = {
      label: label(entry.labelKey),
      icon: entry.icon,
      to: entry.to,
      active: entry.id === section,
      value: entry.id,
    }
    const children = entry.children.map((child) => childItem(child, current, label))
    if (collapsed) {
      return [children.length === 0 ? parent : { ...parent, children }]
    }
    return [parent, ...children.map((child) => ({ ...child, class: SUB_ITEM_CLASS }))]
  })
}

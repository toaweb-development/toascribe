import { describe, expect, it, vi } from 'vitest'

import { menuLabel, noticeLevelLabel, noticeText } from '../app/utils/shell-text.ts'

function translator(known: Record<string, string>) {
  return {
    t: vi.fn((key: string, named?: Record<string, unknown>) => {
      const message = known[key] ?? key
      return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(named?.[name] ?? ''))
    }),
    te: (key: string) => key in known,
  }
}

describe('menuLabel', () => {
  const known = {
    'menu.dashboard': 'Kontrollpanel',
    'menu.users': 'Brukere',
    'menu.unknown': 'Meny',
    'ext.reports': 'Rapporter',
  }

  it('writes the text of a key the core registers', () => {
    expect(menuLabel(translator(known), 'menu.dashboard')).toBe('Kontrollpanel')
    expect(menuLabel(translator(known), 'menu.users')).toBe('Brukere')
  })

  it('writes the text of a key an extension brings, when its message is there', () => {
    expect(menuLabel(translator(known), 'ext.reports')).toBe('Rapporter')
  })

  it('falls back to a plain word for a key nothing has a message for', () => {
    expect(menuLabel(translator(known), 'ext.missing')).toBe('Meny')
  })
})

describe('noticeText', () => {
  const known = {
    'notices.proxyNotTrusted': 'Nettstedet ser alle som {address}.',
    'notices.unknown': 'Et varsel',
  }

  it('fills in the values the api gave the notice', () => {
    expect(noticeText(translator(known), 'notices.proxyNotTrusted', { address: '172.20.0.2' })).toBe(
      'Nettstedet ser alle som 172.20.0.2.',
    )
  })

  it('falls back for a key with no message', () => {
    expect(noticeText(translator(known), 'ext.nothing', {})).toBe('Et varsel')
  })
})

describe('noticeLevelLabel', () => {
  it('has a word for every level', () => {
    const { t } = translator({})
    for (const level of ['error', 'warning', 'success', 'info'] as const) {
      expect(noticeLevelLabel({ t, te: () => true }, level)).toBe(`dashboard.notices.level.${level}`)
    }
  })
})

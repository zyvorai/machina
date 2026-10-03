// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useTranslation } from 'react-i18next'
import { setAppLanguage } from '../i18n'

export default function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const lang = i18n.language.startsWith('es') ? 'es' : 'en'

  return (
    <label className={className ?? 'flex items-center gap-2 text-sm text-[var(--text-muted)]'}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={lang}
        onChange={(e) => setAppLanguage(e.target.value === 'es' ? 'es' : 'en')}
        className="bg-[var(--apple-surface)] border border-[var(--apple-hairline)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
        aria-label={t('common.language')}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </label>
  )
}

// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type GlassButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GlassButtonVariant
  children: ReactNode
}

const variantClass: Record<GlassButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-destructive',
}

export function GlassButton({
  variant = 'primary',
  className = '',
  type = 'button',
  children,
  ...props
}: GlassButtonProps) {
  return (
    <button type={type} className={`${variantClass[variant]} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}

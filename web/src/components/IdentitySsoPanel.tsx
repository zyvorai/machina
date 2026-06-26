// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Shield } from 'lucide-react'
import AdIntegrationPanel from './AdIntegrationPanel'
import OidcIntegrationPanel from './OidcIntegrationPanel'
import SamlMetadataPanel from './SamlMetadataPanel'

type Props = { compact?: boolean }

/** Identity & SSO — LDAP/AD, OIDC, and SAML metadata panels. */
export default function IdentitySsoPanel({ compact }: Props) {
  return (
    <section className="space-y-4">
      {!compact ? (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Shield className="w-4 h-4 text-sky-400" />
            Identity &amp; SSO
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Configure password login (LDAP/PAM), OpenID Connect SSO, and SAML federation metadata.
          </p>
        </div>
      ) : null}
      <OidcIntegrationPanel compact={compact} />
      <SamlMetadataPanel compact={compact} />
      <div className={compact ? '' : 'rounded-xl border border-slate-700/50 bg-slate-800/40 p-4'}>
        {!compact ? (
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Active Directory / LDAP</h3>
        ) : null}
        <AdIntegrationPanel compact={compact} />
      </div>
    </section>
  )
}

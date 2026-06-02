// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { listOpenStackKeypairs, type OpenStackKeyPair } from '../api/openstack'
import { createOpenStackKeypair, deleteOpenStackKeypair } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import PageLayout from '../components/PageLayout'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { Key, Loader2, RefreshCw } from 'lucide-react'

export default function OpenStackKeypairsPage() {
  return (
    <OpenStackGate title="SSH keypairs">
      <OpenStackKeypairsContent />
    </OpenStackGate>
  )
}

function OpenStackKeypairsContent() {
  const toast = useToastContext()
  const [keys, setKeys] = useState<OpenStackKeyPair[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { keypairs } = await listOpenStackKeypairs()
      setKeys(keypairs)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PageLayout
      className="max-w-3xl"
      prepend={<OpenStackSubNav />}
      title="SSH keypairs"
      icon={<Key className="w-7 h-7 text-sky-400" />}
      contentLoading={loading && keys.length === 0}
    >
      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" className="px-3 py-1.5 rounded-lg bg-sky-600 text-sm text-white"
            onClick={async () => {
              if (!name.trim()) return
              try {
                await createOpenStackKeypair({
                  name: name.trim(),
                  public_key: publicKey.trim() || undefined,
                })
                toast.success('Keypair created (Nova may return private key only on generate)')
                setName('')
                setPublicKey('')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}>
            Create / import
          </button>
        </div>
        <textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)} rows={3}
          placeholder="Optional: paste public key (ssh-rsa AAAA...). Leave empty to let Nova generate."
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono" />
      </div>
      <button type="button" onClick={() => void load()}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600 text-sm">
        <RefreshCw className="w-4 h-4" /> Refresh
      </button>
      {!loading && (
        <ul className="rounded-xl border border-slate-700 divide-y divide-slate-800">
          {keys.map((k) => (
            <li key={k.name} className="px-4 py-3 flex justify-between items-center text-sm">
              <span className="font-mono text-slate-200">{k.name}</span>
              <span className="text-slate-500 text-xs">{k.fingerprint || '—'}</span>
              <button type="button" className={statusActionLinkClasses('error', 'text-xs')}
                onClick={async () => {
                  if (!confirm(`Delete keypair ${k.name}?`)) return
                  try {
                    await deleteOpenStackKeypair(k.name)
                    toast.success('Deleted')
                    void load()
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}

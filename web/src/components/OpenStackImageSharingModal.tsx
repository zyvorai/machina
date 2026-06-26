// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { OpenStackImage } from '../api/openstack'
import {
  addOpenStackImageMember,
  deleteOpenStackImageMember,
  listOpenStackImageMembers,
  updateOpenStackImageMetadata,
  updateOpenStackImageVisibility,
  type OpenStackImageMember,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses } from '../utils/semanticColors'

type Props = {
  image: OpenStackImage | null
  onClose: () => void
}

export default function OpenStackImageSharingModal({ image, onClose }: Props) {
  const toast = useToastContext()
  const [members, setMembers] = useState<OpenStackImageMember[]>([])
  const [loading, setLoading] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [metaKey, setMetaKey] = useState('')
  const [metaValue, setMetaValue] = useState('')
  const [visibility, setVisibility] = useState('private')

  const load = useCallback(async () => {
    if (!image) return
    setLoading(true)
    try {
      const { members: list } = await listOpenStackImageMembers(image.id)
      setMembers(list)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [image, toast])

  useEffect(() => {
    if (image) void load()
    else setMembers([])
  }, [image, load])

  if (!image) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-xl" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="font-semibold text-slate-100 truncate pr-2">
            Image sharing · {image.name || image.id.slice(0, 8)}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-slate-800 text-slate-400">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Project members</h3>
            {loading ? (
              <div role="status" aria-label="Loading members">
                <Loader2 className="w-5 h-5 animate-spin text-sky-400" aria-hidden="true" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-slate-500">No members (private image).</p>
            ) : (
              <ul className="text-sm space-y-1 font-mono">
                {members.map((m) => (
                  <li key={m.member_id} className="flex items-center justify-between gap-2">
                    <span className="text-slate-300 truncate">{m.member_id}</span>
                    <span className="text-slate-500 text-xs shrink-0">{m.status}</span>
                    <button
                      type="button"
                      className={`text-xs ${statusActionLinkClasses('error', 'hover:underline shrink-0')}`}
                      onClick={async () => {
                        try {
                          await deleteOpenStackImageMember(image.id, m.member_id)
                          toast.success('Member removed')
                          void load()
                        } catch (e: unknown) {
                          toast.error(formatUserError(e))
                        }
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 mt-2">
              <input
                aria-label="Project ID to add as member"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="Project ID (member)"
                className="flex-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono"
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
                onClick={async () => {
                  const id = memberId.trim()
                  if (!id) return
                  try {
                    await addOpenStackImageMember(image.id, id)
                    toast.success('Member added')
                    setMemberId('')
                    void load()
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Visibility</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                aria-label="Visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm"
              >
                <option value="private">private</option>
                <option value="shared">shared</option>
                <option value="public">public</option>
                <option value="community">community</option>
              </select>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800"
                onClick={async () => {
                  try {
                    await updateOpenStackImageVisibility(image.id, visibility)
                    toast.success(`Visibility set to ${visibility}`)
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Apply visibility
              </button>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Metadata property</h3>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Metadata key"
                value={metaKey}
                onChange={(e) => setMetaKey(e.target.value)}
                placeholder="key"
                className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono w-28"
              />
              <input
                aria-label="Metadata value"
                value={metaValue}
                onChange={(e) => setMetaValue(e.target.value)}
                placeholder="value"
                className="flex-1 min-w-[8rem] px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono"
              />
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800"
                onClick={async () => {
                  const k = metaKey.trim()
                  const v = metaValue.trim()
                  if (!k || !v) {
                    toast.warning('Key and value required')
                    return
                  }
                  try {
                    await updateOpenStackImageMetadata(image.id, { [k]: v })
                    toast.success('Metadata updated')
                    setMetaKey('')
                    setMetaValue('')
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Set
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

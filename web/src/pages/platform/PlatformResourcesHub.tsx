// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Navigate } from 'react-router'

/** @deprecated Kept for bookmarks — redirects to storage. */
export default function PlatformResourcesHub() {
  return <Navigate to="/platform/storage" replace />
}

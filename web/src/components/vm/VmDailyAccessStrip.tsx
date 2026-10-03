// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import VmConnectHub, { type VmConnectHubProps } from './VmConnectHub'

/** @deprecated Use VmConnectHub — kept for backward-compatible imports. */
export type VmDailyAccessStripProps = VmConnectHubProps

export default function VmDailyAccessStrip(props: VmConnectHubProps) {
  return <VmConnectHub {...props} natExpanded={props.natExpanded ?? false} />
}

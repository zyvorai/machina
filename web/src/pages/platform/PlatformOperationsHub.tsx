// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import {
  Activity,
  Archive,
  ArrowRightLeft,
  Bell,
  ClipboardList,
  Download,
  Gauge,
  GitBranch,
  Lightbulb,
  PieChart,
  Shield,
  Wrench,
  Workflow,
} from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, platformStatSubtitle } from '../../components/platform/PlatformPageChrome'
import PlatformHubLaunchpad from '../../components/platform/tahoe/PlatformHubLaunchpad'
import { listNotifications, listPlatformTasks } from '../../api/platform'

export default function PlatformOperationsHub() {
  const [activeTasks, setActiveTasks] = useState<number | null>(null)
  const [unreadAlerts, setUnreadAlerts] = useState<number | null>(null)

  useEffect(() => {
    void Promise.all([
      listPlatformTasks().catch(() => []),
      listNotifications(true).catch(() => []),
    ]).then(([tasks, alerts]) => {
      setActiveTasks(tasks.filter((t) => t.status === 'running' || t.status === 'pending').length)
      setUnreadAlerts(alerts.length)
    })
  }, [])

  return (
    <PlatformPageChrome
      prepend={<PlatformBackLink to="/platform" label="Platform" />}
      title="Operations"
      subtitle={
        <span className="flex flex-col gap-1">
          <span className="text-slate-400">Lifecycle, monitoring, and fleet insights</span>
          {platformStatSubtitle([
            { label: 'Active tasks', value: activeTasks != null ? String(activeTasks) : '—' },
            { label: 'Unread alerts', value: unreadAlerts != null ? String(unreadAlerts) : '—' },
          ])}
        </span>
      }
      icon={<Wrench className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >
        <PlatformHubLaunchpad
          groups={[
            {
              label: 'Lifecycle',
              subtitle: 'Migration, backup, DR, and updates',
              tiles: [
                { to: '/platform/migration', label: 'Migration Assistant', icon: <ArrowRightLeft className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/backups', label: 'Time Machine', icon: <Archive className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/placement', label: 'Disaster Recovery', icon: <Shield className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/maintenance', label: 'Software Update', icon: <Download className="w-8 h-8" strokeWidth={1.75} /> },
              ],
            },
            {
              label: 'Monitor',
              subtitle: 'Tasks, alerts, and activity',
              tiles: [
                { to: '/platform/tasks', label: 'Tasks', icon: <ClipboardList className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/notifications', label: 'Alerts', icon: <Bell className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/activity', label: 'Activity Monitor', icon: <Activity className="w-8 h-8" strokeWidth={1.75} /> },
              ],
            },
            {
              label: 'Insights',
              subtitle: 'Recommendations, shortcuts, topology',
              tiles: [
                { to: '/platform/recommendations', label: 'Recommendations', icon: <Lightbulb className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/blueprints', label: 'Shortcuts', icon: <Workflow className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/topology', label: 'Topology', icon: <GitBranch className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/observability', label: 'Observability', icon: <Gauge className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/reports?tab=runbooks', label: 'Reports & Runbooks', icon: <PieChart className="w-8 h-8" strokeWidth={1.75} /> },
              ],
            },
          ]}
        />
    </PlatformPageChrome>
  )
}

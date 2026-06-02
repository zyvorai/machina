// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getMetrics, getMetricsHistory, VmMetrics, vmDetailRoute } from '../api/vm'
import {
  Activity,
  RefreshCw,
  Download,
  Cpu,
  HardDrive,
  Network,
  Gauge,
  ChevronRight,
} from 'lucide-react'
import { downloadJSON, downloadCSV } from '../utils/export'
import PageLayout from '../components/PageLayout'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusBgClass, statusToneClass, utilizationTone } from '../utils/semanticColors'
import { libvirtErrorHints } from '../utils/libvirtHints'
import { formatBytes, formatThroughput } from '../utils/vm'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from 'recharts'

const POLL_MS = 5000
const MAX_POINTS = 48
const MAX_VM_LINES = 10

const VM_LINE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#eab308',
  '#f97316',
  '#14b8a6',
  '#fb7185',
]

function chartMemKey(name: string) {
  return `mem:${name}`
}
function chartCpuKey(name: string) {
  return `cpu:${name}`
}

interface VmExtras {
  cpuPct: number
  rdBps: number
  wrBps: number
  rxBps: number
  txBps: number
}

type TimelineRow = Record<string, number | string>

export default function EventsPage() {
  const [metrics, setMetrics] = useState<VmMetrics[]>([])
  const [timeline, setTimeline] = useState<TimelineRow[]>([])
  const [vmExtras, setVmExtras] = useState<Record<string, VmExtras>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const prevRef = useRef<{ byName: Map<string, VmMetrics>; at: number } | null>(null)
  const historySeeded = useRef(false)

  useEffect(() => {
    if (historySeeded.current) return
    historySeeded.current = true
    getMetricsHistory(MAX_POINTS)
      .then((h) => {
        if (!h.points?.length) return
        const rows: TimelineRow[] = h.points.map((p) => {
          const timeStr = new Date(p.timestamp_ms).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
          const row: TimelineRow = { time: timeStr }
          for (const m of p.vm_metrics) {
            row[chartMemKey(m.name)] = parseFloat(m.memory_pct.toFixed(1))
          }
          return row
        })
        setTimeline(rows.slice(-MAX_POINTS))
        const last = h.points[h.points.length - 1]
        if (last?.vm_metrics?.length) {
          prevRef.current = {
            byName: new Map(last.vm_metrics.map((m) => [m.name, m])),
            at: last.timestamp_ms,
          }
        }
      })
      .catch(() => {})
  }, [])

  const sortedMetrics = useMemo(
    () => [...metrics].sort((a, b) => a.name.localeCompare(b.name)),
    [metrics],
  )

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      const list = await getMetrics()
      setMetrics(list)

      if (list.length === 0) {
        prevRef.current = null
        return
      }

      const now = Date.now()
      const prev = prevRef.current
      const wallSec = prev?.at ? Math.max(0.5, (now - prev.at) / 1000) : POLL_MS / 1000

      const timeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      const row: TimelineRow = { time: timeStr }

      const extras: Record<string, VmExtras> = {}
      let sumMem = 0
      let sumCpu = 0
      let aggRd = 0
      let aggWr = 0
      let aggRx = 0
      let aggTx = 0

      const byName = new Map(list.map((m) => [m.name, m]))

      for (const m of list) {
        row[chartMemKey(m.name)] = parseFloat(m.memory_pct.toFixed(1))
        sumMem += m.memory_pct

        const p = prev?.byName.get(m.name)
        let cpuPct = 0
        let rdBps = 0
        let wrBps = 0
        let rxBps = 0
        let txBps = 0
        if (p) {
          const cpuDelta = m.cpu_time_ns - p.cpu_time_ns
          cpuPct =
            m.vcpus > 0
              ? Math.min(100, Math.max(0, (cpuDelta / 1e9) / wallSec / m.vcpus * 100))
              : 0
          rdBps = Math.max(0, m.disk_rd_bytes - p.disk_rd_bytes) / wallSec
          wrBps = Math.max(0, m.disk_wr_bytes - p.disk_wr_bytes) / wallSec
          rxBps = Math.max(0, m.net_rx_bytes - p.net_rx_bytes) / wallSec
          txBps = Math.max(0, m.net_tx_bytes - p.net_tx_bytes) / wallSec
        }
        row[chartCpuKey(m.name)] = parseFloat(cpuPct.toFixed(1))
        extras[m.name] = { cpuPct, rdBps, wrBps, rxBps, txBps }
        sumCpu += cpuPct
        aggRd += rdBps
        aggWr += wrBps
        aggRx += rxBps
        aggTx += txBps
      }

      row.avgMem = sumMem / list.length
      row.avgCpu = sumCpu / list.length
      row.diskRdBps = aggRd
      row.diskWrBps = aggWr
      row.netRxBps = aggRx
      row.netTxBps = aggTx

      setTimeline((t) => [...t.slice(-(MAX_POINTS - 1)), row])
      setVmExtras(extras)
      prevRef.current = { byName, at: now }
    } catch (e: unknown) {
      setLoadError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const i = setInterval(load, POLL_MS)
    return () => clearInterval(i)
  }, [load])

  const latest = timeline[timeline.length - 1]
  const barData = useMemo(
    () =>
      [...metrics]
        .sort((a, b) => b.memory_pct - a.memory_pct)
        .map((m) => ({
          label: m.name.length > 32 ? `${m.name.slice(0, 30)}…` : m.name,
          mem: Number(m.memory_pct.toFixed(1)),
          fullName: m.name,
        })),
    [metrics],
  )

  const chartVmSubset = sortedMetrics.slice(0, MAX_VM_LINES)
  const vmLineOverflow = sortedMetrics.length - chartVmSubset.length

  const tooltipStyle = {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '0.5rem',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
  }

  return (
    <PageLayout
      className="min-w-0"
      title="Live Metrics"
      icon={<Activity className={`w-6 h-6 ${statusToneClass('info')}`} />}
      subtitle={
        <>
          Running guests from libvirt. Throughput and CPU % use deltas between polls (~
          {POLL_MS / 1000}s); cumulative disk/net counters match VM detail views.
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => downloadJSON(metrics, 'metrics.json')}
            className="p-2 hover:bg-slate-700 rounded transition"
            title="Export JSON"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => downloadCSV(metrics as unknown as Record<string, unknown>[], 'metrics.csv')}
            className="p-2 hover:bg-slate-700 rounded transition"
            title="Export CSV"
          >
            <Download className={`w-4 h-4 ${statusToneClass('ok')}`} />
          </button>
          <button type="button" onClick={load} className="p-2 hover:bg-slate-700 rounded transition">
            <RefreshCw className="w-4 h-4" />
          </button>
        </>
      }
      error={loadError}
      errorTitle="Could not load metrics"
      errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
      onErrorRetry={load}
      contentLoading={loading}
      contentClassName="space-y-6"
    >
      {!loading && metrics.length === 0 ? (
        <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-12 text-center text-slate-500">
          No running VMs with metrics.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide">
                <Gauge className="w-3.5 h-3.5" /> Guests
              </div>
              <div className="text-2xl font-semibold text-white mt-1">{metrics.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">running domains</div>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide">
                <Activity className="w-3.5 h-3.5" /> Avg memory
              </div>
              <div className={`text-2xl font-semibold mt-1 ${latest ? statusToneClass(utilizationTone(Number(latest.avgMem))) : 'text-white'}`}>
                {latest ? `${Number(latest.avgMem).toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">balloon / RSS derived</div>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide">
                <Cpu className="w-3.5 h-3.5" /> Avg guest CPU
              </div>
              <div className={`text-2xl font-semibold mt-1 ${latest ? statusToneClass(utilizationTone(Number(latest.avgCpu))) : 'text-white'}`}>
                {latest ? `${Number(latest.avgCpu).toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">from cpu_time deltas</div>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide">
                <HardDrive className="w-3.5 h-3.5" /> Host I/O (sum)
              </div>
              <div className="text-sm font-medium text-slate-200 mt-2 space-y-0.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Disk R+W</span>
                  <span>
                    {latest
                      ? `${formatThroughput(Number(latest.diskRdBps) + Number(latest.diskWrBps))}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Net RX+TX</span>
                  <span>
                    {latest
                      ? `${formatThroughput(Number(latest.netRxBps) + Number(latest.netTxBps))}`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0 relative z-0">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Activity className={`w-4 h-4 ${statusToneClass('info')}`} /> Memory % (per VM)
                </h2>
                {vmLineOverflow > 0 && (
                  <span className="text-[10px] text-slate-500">
                    +{vmLineOverflow} more in table / snapshot bar
                  </span>
                )}
              </div>
              <div className="h-[260px] w-full min-w-0 isolate">
                {timeline.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis
                        stroke="#475569"
                        fontSize={10}
                        domain={[0, 100]}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(value: number) => [`${value}%`, '']}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, maxHeight: 72, overflowY: 'auto' }} />
                      {chartVmSubset.map((m, i) => (
                        <Line
                          key={m.name}
                          type="monotone"
                          dataKey={chartMemKey(m.name)}
                          name={m.name}
                          stroke={VM_LINE_COLORS[i % VM_LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Collecting samples… next point in a few seconds.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 min-w-0">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Cpu className={`w-4 h-4 ${statusToneClass('warn')}`} /> Guest CPU % (estimated)
              </h2>
              <div className="h-[260px] w-full min-w-0 isolate">
                {timeline.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis
                        stroke="#475569"
                        fontSize={10}
                        domain={[0, 100]}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(value: number) => [`${value}%`, '']}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, maxHeight: 72, overflowY: 'auto' }} />
                      {chartVmSubset.map((m, i) => (
                        <Line
                          key={m.name}
                          type="monotone"
                          dataKey={chartCpuKey(m.name)}
                          name={m.name}
                          stroke={VM_LINE_COLORS[i % VM_LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Collecting samples…
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 min-w-0 xl:col-span-1">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <HardDrive className={`w-4 h-4 ${statusToneClass('ok')}`} /> Disk throughput (all VMs)
              </h2>
              <div className="h-[220px] w-full min-w-0">
                {timeline.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="metricsDiskReadGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="metricsDiskWriteGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis
                        stroke="#475569"
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v: number) => formatThroughput(v)}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(v: number) => formatThroughput(v)}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="diskRdBps"
                        name="Read"
                        stroke="#10b981"
                        strokeWidth={1.5}
                        fillOpacity={1}
                        fill="url(#metricsDiskReadGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="diskWrBps"
                        name="Write"
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        fillOpacity={1}
                        fill="url(#metricsDiskWriteGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Collecting samples…
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 min-w-0 xl:col-span-1">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                <Network className="w-4 h-4 text-cyan-400" /> Network throughput (all VMs)
              </h2>
              <div className="h-[220px] w-full min-w-0">
                {timeline.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="metricsNetRxGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="metricsNetTxGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                      <YAxis
                        stroke="#475569"
                        fontSize={10}
                        tickLine={false}
                        tickFormatter={(v: number) => formatThroughput(v)}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(v: number) => formatThroughput(v)}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="netRxBps"
                        name="RX"
                        stroke="#06b6d4"
                        strokeWidth={1.5}
                        fillOpacity={1}
                        fill="url(#metricsNetRxGrad)"
                      />
                      <Area
                        type="monotone"
                        dataKey="netTxBps"
                        name="TX"
                        stroke="#a855f7"
                        strokeWidth={1.5}
                        fillOpacity={1}
                        fill="url(#metricsNetTxGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                    Collecting samples…
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Snapshot bar + detail table */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 min-w-0">
              <h2 className="text-sm font-semibold text-white mb-3">Memory snapshot</h2>
              <div
                style={{ height: Math.min(420, 48 + barData.length * 36) }}
                className="min-h-[180px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left: 4, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} stroke="#475569" fontSize={10} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="label" width={148} stroke="#64748b" fontSize={10} tickLine={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: number) => [`${v}%`, 'Memory']}
                      labelFormatter={(_, p) =>
                        (p?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? ''
                      }
                    />
                    <Bar dataKey="mem" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden min-w-0">
              <div className="px-5 py-3 border-b border-slate-700/50">
                <h2 className="text-sm font-semibold text-white">Detail</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-left text-slate-400">
                      <th className="px-4 py-2.5">VM</th>
                      <th className="px-4 py-2.5">Mem</th>
                      <th className="px-4 py-2.5 hidden sm:table-cell">CPU</th>
                      <th className="px-4 py-2.5 hidden md:table-cell">Disk R/W</th>
                      <th className="px-4 py-2.5 hidden lg:table-cell">Net RX/TX</th>
                      <th className="px-4 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {sortedMetrics.map((m) => {
                      const ex = vmExtras[m.name]
                      return (
                        <tr key={m.name} className="hover:bg-slate-700/40">
                          <td className="px-4 py-2.5">
                            <Link
                              to={vmDetailRoute(m.name, m.libvirt_connection)}
                              className={`font-medium truncate block max-w-[220px] md:max-w-xs ${statusActionLinkClasses('info')}`}
                              title={m.name}
                            >
                              {m.name}
                            </Link>
                            <div className="text-[10px] text-slate-500">
                              {m.vcpus} vCPU · {m.memory_used_mb} / {m.memory_total_mb} MB
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-slate-700 rounded-full h-2 shrink-0">
                                <div
                                  className={`h-2 rounded-full transition-all ${statusBgClass(utilizationTone(m.memory_pct))}`}
                                  style={{ width: `${Math.min(100, m.memory_pct)}%` }}
                                />
                              </div>
                              <span className="text-slate-400 tabular-nums">{m.memory_pct.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-300 tabular-nums hidden sm:table-cell">
                            {ex ? `${ex.cpuPct.toFixed(0)}%` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-300 text-xs hidden md:table-cell">
                            {ex ? (
                              <span>
                                {formatThroughput(ex.rdBps)}{' '}
                                <span className="text-slate-500">/</span> {formatThroughput(ex.wrBps)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-300 text-xs hidden lg:table-cell">
                            {ex ? (
                              <span>
                                {formatThroughput(ex.rxBps)}{' '}
                                <span className="text-slate-500">/</span> {formatThroughput(ex.txBps)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <Link
                              to={vmDetailRoute(m.name, m.libvirt_connection)}
                              className="inline-flex p-1 rounded hover:bg-slate-600/40 text-slate-500 hover:text-slate-300"
                              aria-label={`Open ${m.name}`}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  )
}

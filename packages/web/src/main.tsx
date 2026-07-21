import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Database,
  FileText,
  Home,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import './styles.css'

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> }

type Overview = {
  generatedAt: string
  accessMode: 'tunnel' | 'public'
  data: {
    usableRecords: number
    confirmedRecords: number
    singleSourceRecords: number
    conflictRecords: number
    latestPeriod: string | null
    latestDrawDate: string | null
    dualSourceCoverage: number | null
  }
  latestRun: OnlineRun | null
  latestReport: DailyReportSummary | null
  latestPrediction: PredictionPayload | null
  currentSettlement: unknown
  ledger: {
    total: number
    pending: number
    provisional: number
    confirmed: number
    disputed: number
    settled: number
  }
  tools: string[]
}

type OnlineRun = {
  runId: string
  predictionId: string | null
  status: 'running' | 'success' | 'failed'
  afterPeriod: string | null
  targetPeriod: string | null
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
}

type DailyReportSummary = {
  runId: string
  day: string
  generatedAt: string
  predictionId: string
  afterPeriod: string
  reportPath: string
  markdownPath: string
  reportHash: string
  snapshotSettlement: unknown
}

type ReportDetail = {
  summary: DailyReportSummary
  payload: {
    generatedAt: string
    prediction: PredictionPayload
    sync: null | {
      provider: string
      records: number
      confirmedRecords: number
      singleSourceRecords: number
      conflictRecords: number
      warnings: string[]
    }
  }
  markdown: string
  currentSettlement: unknown
}

type PredictionPayload = {
  predictionId: string
  generatedAt: string
  afterPeriod: string
  target: string
  model: { version: string; weights?: Record<string, number> }
  training: { recordCount: number; fromPeriod: string; toPeriod: string; trainingDataHash: string }
  query: { periods: number; tickets: number; playType: string }
  tickets: Array<{ rank: number; playType: string; display: string; score: number }>
  backtest: {
    status: string
    cases?: number
    totalCost?: number
    totalReturn?: number
    roi?: number
    hits?: Record<string, number>
    baselines?: Record<string, number>
  }
  payouts: { stake: number; direct: number; group3: number; group6: number; note: string }
  settlement: unknown
}

type Operation = {
  eventId: number
  level: 'info' | 'warning' | 'error'
  eventType: string
  message: string
  details: Record<string, unknown>
  createdAt: string
}

const navigation = [
  { key: 'overview', label: '总览', icon: Home },
  { key: 'reports', label: '历史日报', icon: FileText },
  { key: 'backtest', label: '回测分析', icon: BarChart3 },
  { key: 'quality', label: '数据质量', icon: ShieldCheck },
  { key: 'ops', label: '运行状态', icon: Activity },
] as const

type PageKey = typeof navigation[number]['key']

const beijingDateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const beijingDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const formatTime = (value?: string | null) => value ? beijingDateTime.format(new Date(value)) : '暂无'
const formatDate = (value?: string | null) => value ? beijingDate.format(new Date(value)) : '暂无'
const pct = (value?: number | null) => typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '未知'

const apiGet = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }
  const payload = await response.json() as ApiEnvelope<T>
  return payload.data
}

function useApi<T>(url: string, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await apiGet<T>(url))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void reload() }, deps)
  return { data, error, loading, reload }
}

const Chart = ({ option }: { option: echarts.EChartsCoreOption }) => {
  const ref = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return undefined
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.setOption(option)
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chart.dispose()
    }
  }, [option])
  return <div ref={ref} className="chart" />
}

const NumberBall = ({ value }: { value: string }) => <span className="number-ball">{value}</span>

const TicketList = ({ tickets }: { tickets: PredictionPayload['tickets'] }) => (
  <div className="ticket-grid">
    {tickets.map((ticket) => (
      <div className="ticket-card" key={`${ticket.playType}-${ticket.display}-${ticket.rank}`}>
        <div className="ticket-rank">#{ticket.rank}</div>
        <div className="ticket-numbers">{ticket.display.split(/[,\s]+/).filter(Boolean).map((item) => (
          <NumberBall key={`${ticket.rank}-${item}`} value={item} />
        ))}</div>
        <div className="ticket-meta">
          <span>{playLabel(ticket.playType)}</span>
          <span>模型排序分 {ticket.score.toFixed(6)}</span>
        </div>
      </div>
    ))}
  </div>
)

const playLabel = (value: string) => ({
  direct: '直选',
  group3: '组三',
  group6: '组六',
  mixed: '混合',
}[value] || value)

const statusLabel = (value: string) => ({
  running: '运行中',
  success: '成功',
  failed: '失败',
  pending: '待复盘',
  provisional: '暂定复盘',
  confirmed: '已确认',
  disputed: '有争议',
  settled: '已结算',
}[value] || value)

function Login({ onReady }: { onReady: () => void }) {
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password, totp }),
    })
    if (!response.ok) {
      setError(await response.text())
      return
    }
    onReady()
  }
  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">P3</div>
        <h1>Lotterymcp 排列3研究台</h1>
        <p>请输入服务器管理员配置的访问口令与动态验证码。</p>
        <label>
          <span>访问口令</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        <label>
          <span>动态验证码</span>
          <input value={totp} onChange={(event) => setTotp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
        </label>
        {error ? <div className="error-line">{error}</div> : null}
        <button type="submit">登录</button>
      </form>
    </main>
  )
}

function OverviewPage({ overview }: { overview: Overview }) {
  const prediction = overview.latestPrediction
  const settlement = overview.currentSettlement as { status?: string; targetPeriod?: string; actualNumbers?: number[] } | null
  return (
    <div className="page-stack">
      <section className="summary-band">
        <div>
          <span className="eyebrow">排列3下一期开奖研究</span>
          <h1>{prediction ? `截止 ${prediction.afterPeriod} 期的候选` : '暂无预测'}</h1>
          <p>本页仅展示模型排序候选与历史模拟表现，不表达中奖概率、信心或收益承诺。</p>
        </div>
        <div className="hero-stats">
          <Metric label="可用记录" value={`${overview.data.usableRecords}`} />
          <Metric label="最新期号" value={overview.data.latestPeriod || '暂无'} />
          <Metric label="复盘状态" value={statusLabel(settlement?.status || 'pending')} />
        </div>
      </section>
      {prediction ? <TicketList tickets={prediction.tickets.slice(0, 10)} /> : null}
      <div className="two-column">
        <Panel title="数据可信状态" icon={<ShieldCheck size={18} />}>
          <div className="metric-list">
            <Metric label="双官方确认" value={`${overview.data.confirmedRecords}`} />
            <Metric label="单来源记录" value={`${overview.data.singleSourceRecords}`} />
            <Metric label="未解决冲突" value={`${overview.data.conflictRecords}`} tone={overview.data.conflictRecords > 0 ? 'danger' : 'good'} />
            <Metric label="双源覆盖率" value={pct(overview.data.dualSourceCoverage)} />
          </div>
        </Panel>
        <Panel title="当前复盘" icon={<Trophy size={18} />}>
          <div className="info-rows">
            <Info label="预测 ID" value={prediction?.predictionId.slice(0, 16) || '暂无'} />
            <Info label="目标绑定" value={settlement?.targetPeriod || '等待下一期开奖'} />
            <Info label="开奖号码" value={settlement?.actualNumbers?.join(',') || '暂无'} />
            <Info label="生成时间" value={formatTime(prediction?.generatedAt)} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function ReportsPage({ reports }: { reports: DailyReportSummary[] }) {
  const [selected, setSelected] = useState(reports[0]?.runId || '')
  const { data } = useApi<ReportDetail>(selected ? `/api/v1/reports/${encodeURIComponent(selected)}` : '/api/v1/reports/none', [selected])
  useEffect(() => {
    if (!selected && reports[0]) setSelected(reports[0].runId)
  }, [reports, selected])
  return (
    <div className="reports-layout">
      <aside className="report-list">
        {reports.map((report) => (
          <button key={report.runId} className={selected === report.runId ? 'active' : ''} onClick={() => setSelected(report.runId)}>
            <span>{report.day}</span>
            <strong>{report.afterPeriod} 期后</strong>
            <small>{report.runId}</small>
          </button>
        ))}
      </aside>
      <section className="report-detail">
        {data ? (
          <>
            <h2>{data.summary.day} 日报</h2>
            <div className="metric-list compact">
              <Metric label="生成时间" value={formatTime(data.summary.generatedAt)} />
              <Metric label="训练期数" value={`${data.payload.prediction.training.recordCount}`} />
              <Metric label="玩法" value={playLabel(data.payload.prediction.query.playType)} />
              <Metric label="当前复盘" value={statusLabel(String((data.currentSettlement as any)?.status || 'pending'))} />
            </div>
            <pre className="markdown-preview">{data.markdown}</pre>
          </>
        ) : <Empty title="请选择日报" />}
      </section>
    </div>
  )
}

function BacktestPage({ prediction }: { prediction: PredictionPayload | null }) {
  const backtest = prediction?.backtest
  const option = useMemo(() => ({
    tooltip: {},
    grid: { left: 40, right: 20, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: ['成本', '回报', 'ROI x100'] },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: [
        backtest?.totalCost || 0,
        backtest?.totalReturn || 0,
        typeof backtest?.roi === 'number' ? Math.round(backtest.roi * 10000) / 100 : 0,
      ],
      itemStyle: { color: '#1677ff' },
    }],
  }), [backtest])
  return (
    <div className="page-stack">
      <Panel title="Walk-forward 回测" icon={<BarChart3 size={18} />}>
        <div className="metric-list">
          <Metric label="状态" value={statusLabel(backtest?.status || '暂无')} />
          <Metric label="测试折数" value={`${backtest?.cases || 0}`} />
          <Metric label="历史模拟 ROI" value={typeof backtest?.roi === 'number' ? `${(backtest.roi * 100).toFixed(2)}%` : '暂无'} />
          <Metric label="单注成本" value={`${prediction?.payouts.stake || 2} 元`} />
        </div>
        <Chart option={option} />
        <p className="muted-text">{prediction?.payouts.note || 'ROI 仅为历史模拟，不代表未来表现。'}</p>
      </Panel>
    </div>
  )
}

function QualityPage({ overview }: { overview: Overview }) {
  const option = useMemo(() => ({
    tooltip: {},
    legend: { bottom: 0 },
    grid: { left: 48, right: 24, top: 24, bottom: 56 },
    xAxis: { type: 'category', data: ['confirmed', 'single_source', 'conflict'] },
    yAxis: { type: 'value' },
    series: [{
      name: '记录数',
      type: 'bar',
      data: [overview.data.confirmedRecords, overview.data.singleSourceRecords, overview.data.conflictRecords],
      itemStyle: { color: (params: any) => ['#00a870', '#faad14', '#d93026'][params.dataIndex] },
    }],
  }), [overview])
  return (
    <div className="page-stack">
      <Panel title="数据质量概览" icon={<Database size={18} />}>
        <Chart option={option} />
        <div className="info-rows">
          <Info label="最新开奖日期" value={formatDate(overview.data.latestDrawDate)} />
          <Info label="数据目录状态" value={overview.data.usableRecords >= 100 ? '可用于普通预测' : '数据不足'} />
          <Info label="正式实验门槛" value={overview.data.confirmedRecords >= 2000 ? '满足最近 2000 confirmed 要求' : 'confirmed 数据不足 2000'} />
        </div>
      </Panel>
    </div>
  )
}

function OpsPage({ runs, operations }: { runs: OnlineRun[]; operations: Operation[] }) {
  return (
    <div className="two-column">
      <Panel title="预测运行" icon={<CalendarClock size={18} />}>
        <div className="timeline">
          {runs.map((run) => (
            <div className={`timeline-item ${run.status}`} key={run.runId}>
              <strong>{statusLabel(run.status)} · {run.afterPeriod || '未知期号'}</strong>
              <span>{formatTime(run.startedAt)}</span>
              {run.errorMessage ? <small>{run.errorMessage}</small> : null}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="系统事件" icon={<Activity size={18} />}>
        <div className="timeline">
          {operations.map((event) => (
            <div className={`timeline-item ${event.level}`} key={event.eventId}>
              <strong>{event.message}</strong>
              <span>{formatTime(event.createdAt)} · {event.eventType}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'danger' }) {
  return <div className={`metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong></div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="panel"><header>{icon}<h2>{title}</h2></header>{children}</section>
}

function Empty({ title }: { title: string }) {
  return <div className="empty">{title}</div>
}

function App() {
  const [page, setPage] = useState<PageKey>('overview')
  const [sessionTick, setSessionTick] = useState(0)
  const session = useApi<{ authenticated: boolean; accessMode: 'tunnel' | 'public'; authRequired: boolean }>('/api/v1/session', [sessionTick])
  const overview = useApi<Overview>('/api/v1/overview', [sessionTick])
  const reports = useApi<{ reports: DailyReportSummary[] }>('/api/v1/reports?limit=30', [sessionTick])
  const ops = useApi<{ runs: OnlineRun[]; operations: Operation[] }>('/api/v1/operations?limit=30', [sessionTick])

  if (session.loading) return <main className="loading">加载中</main>
  if (session.data?.authRequired && !session.data.authenticated) {
    return <Login onReady={() => setSessionTick((value) => value + 1)} />
  }

  const logout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
    setSessionTick((value) => value + 1)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo-block"><span>P3</span><strong>排列3研究台</strong></div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon
            return <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
              <Icon size={18} /> {item.label}
            </button>
          })}
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <strong>Lotterymcp</strong>
            <span>{overview.data ? `更新 ${formatTime(overview.data.generatedAt)}` : '等待数据'}</span>
          </div>
          <div className="topbar-actions">
            <button onClick={() => { void overview.reload(); void reports.reload(); void ops.reload() }} title="刷新"><RefreshCw size={18} /></button>
            {session.data?.authRequired ? <button onClick={logout} title="退出"><LogOut size={18} /></button> : null}
          </div>
        </header>
        {overview.error ? <div className="error-line">{overview.error}</div> : null}
        {!overview.data ? <main className="loading">等待排列3数据</main> : (
          <>
            {page === 'overview' ? <OverviewPage overview={overview.data} /> : null}
            {page === 'reports' ? <ReportsPage reports={reports.data?.reports || []} /> : null}
            {page === 'backtest' ? <BacktestPage prediction={overview.data.latestPrediction} /> : null}
            {page === 'quality' ? <QualityPage overview={overview.data} /> : null}
            {page === 'ops' ? <OpsPage runs={ops.data?.runs || []} operations={ops.data?.operations || []} /> : null}
          </>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Database,
  FileText,
  FlaskConical,
  Home,
  LineChart as LineChartIcon,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import './styles.css'
import { renderMarkdown } from './lib/markdown'

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

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
    latestDraw: {
      period: string
      period_num: number
      draw_date: string
      d1: number
      d2: number
      d3: number
      numbers: string
      drawStatus: string
    } | null
    dualSourceCoverage: number | null
    confidenceByYear: Array<{
      year: string
      totalPeriods: number
      confirmedRecords: number
      singleSourceRecords: number
      conflictRecords: number
      dualSourceCoverage: number | null
    }>
    slaEvidence: {
      total: number
      withEvidence: number
      verifiedBeforeObservation: number
      violated: number
      pendingEvidence: number
    }
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
  training: {
    recordCount: number
    fromPeriod: string
    toPeriod: string
    trainingDataHash: string
    dataStatus?: {
      confirmedRecords: number
      singleSourceRecords: number
      conflictRecords: number
      unclassifiedRecords: number
      dualSourceCoverage: number | null
    }
  }
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

type Experiment = {
  experimentId: string
  name: string
  mode: string
  status: string
  datasetSnapshotId: string
  specHash: string
  codeCommit: string
  reportHash: string | null
  reportPath: string | null
  createdAt: string
  spec: {
    hypothesis?: string
    mode?: string
    models?: string[]
    primaryMetric?: string
    split?: Record<string, unknown>
    bootstrap?: Record<string, unknown>
  } | null
}

type ExperimentFold = {
  foldLevel: string
  foldIndex: number
  status: string
  trainFromPeriod: string
  trainToPeriod: string
  testFromPeriod: string
  testToPeriod: string
  selectedParamsJson: string | null
  metricsJson: string | null
  startedAt: string | null
  completedAt: string | null
}

type ExperimentDetail = {
  experiment: Experiment
  spec: Record<string, unknown>
  folds: ExperimentFold[]
  audit: Array<{ action: string; status: string; createdAt: string; details?: Record<string, unknown> }>
}

type DatasetSnapshotSummary = {
  snapshotId: string
  fromPeriod: string
  afterPeriod: string
  recordCount: number
  dataHash: string
  codeCommit: string | null
  quality: Record<string, unknown>
  createdAt: string
  verified: boolean | null
}

type SnapshotDetail = {
  snapshot: {
    snapshotId: string
    fromPeriod: string
    afterPeriod: string
    recordCount: number
    dataHash: string
    codeCommit: string | null
    quality: Record<string, unknown>
    createdAt: string
  }
  verification: {
    valid: boolean
    actualRecordCount: number
    expectedRecordCount: number
  } | null
  experiments: Array<{
    experimentId: string
    name: string
    mode: string
    status: string
    reportHash: string | null
    reportPath: string | null
    createdAt: string
  }>
}

type LedgerRow = {
  predictionId: string
  afterPeriod: string
  playType: string
  targetPeriod: string | null
  actualNumbers: number[] | null
  status: string
  winningTickets: number
  returnAmount: number
  profit: number
  generatedAt: string
  ticketCount: number
}

type LedgerTotals = { profit: number; winning: number; hits: number }

type DrawRow = {
  period: string
  period_num: number
  draw_date: string
  d1: number
  d2: number
  d3: number
  numbers: string
  drawStatus: string | null
}

type TrendPoint = { period: string; value: number }
type TrendSeries = {
  cumulativeProfit: TrendPoint[]
  hitRate: TrendPoint[]
  perPeriod: Array<{ period: string; profit: number; winning: boolean }>
  count: number
}

const navigation = [
  { key: 'overview', label: '总览', icon: Home },
  { key: 'reports', label: '历史日报', icon: FileText },
  { key: 'backtest', label: '回测分析', icon: BarChart3 },
  { key: 'quality', label: '数据质量', icon: ShieldCheck },
  { key: 'experiments', label: '实验评估', icon: FlaskConical },
  { key: 'snapshots', label: '数据快照', icon: Database },
  { key: 'ledger', label: '账本与趋势', icon: TrendingUp },
  { key: 'analysis', label: '走势分析', icon: LineChartIcon },
  { key: 'ops', label: '运行状态', icon: Activity },
] as const

type PageKey = (typeof navigation)[number]['key']

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

const formatTime = (value?: string | null) => (value ? beijingDateTime.format(new Date(value)) : '暂无')
const formatDate = (value?: string | null) => (value ? beijingDate.format(new Date(value)) : '暂无')
const pct = (value?: number | null) => (typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '未知')

const relativeTime = (ts: number, _tick: number) => {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 5) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  return formatTime(new Date(ts).toISOString())
}

// Markdown 渲染已提取至 ./lib/markdown.ts（含 XSS 转义），由该模块统一导出 renderMarkdown。

const apiGet = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }
  const payload = (await response.json()) as ApiEnvelope<T>
  return payload.data
}

function useApi<T>(url: string, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = async () => {
    if (!url) {
      setLoading(false)
      setError(null)
      setData(null)
      return
    }
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
  useEffect(() => {
    void reload()
  }, deps)
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
        <div className="ticket-numbers">
          {ticket.display
            .split(/[,\s]+/)
            .filter(Boolean)
            .map((item) => (
              <NumberBall key={`${ticket.rank}-${item}`} value={item} />
            ))}
        </div>
        <div className="ticket-meta">
          <span>{playLabel(ticket.playType)}</span>
          <span>模型排序分 {ticket.score.toFixed(6)}</span>
        </div>
      </div>
    ))}
  </div>
)

const playLabel = (value: string) =>
  ({
    direct: '直选',
    group3: '组三',
    group6: '组六',
    mixed: '混合',
  })[value] || value

const statusLabel = (value: string) =>
  ({
    running: '运行中',
    success: '成功',
    failed: '失败',
    pending: '待复盘',
    provisional: '暂定复盘',
    confirmed: '已确认',
    disputed: '有争议',
    settled: '已结算',
  })[value] || value

const formatTrainingDataStatus = (dataStatus: PredictionPayload['training']['dataStatus']) => {
  if (!dataStatus || typeof dataStatus.dualSourceCoverage !== 'number') return '未标注来源'
  const coverage = Math.round(dataStatus.dualSourceCoverage * 1000) / 10
  return `双源确认 ${dataStatus.confirmedRecords} 期（${coverage}%）`
}

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
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        <label>
          <span>动态验证码</span>
          <input
            value={totp}
            onChange={(event) => setTotp(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </label>
        {error ? <div className="error-line">{error}</div> : null}
        <button type="submit">登录</button>
      </form>
    </main>
  )
}

function OverviewPage({ overview }: { overview: Overview }) {
  const prediction = overview.latestPrediction
  const settlement = overview.currentSettlement as {
    status?: string
    targetPeriod?: string
    drawDate?: string
    actualNumbers?: number[]
    winningTickets?: number
    returnAmount?: number
    profit?: number
  } | null
  const latestDrawData = overview.data.latestDraw
  const latestNumbers =
    settlement?.actualNumbers ||
    (latestDrawData ? [latestDrawData.d1, latestDrawData.d2, latestDrawData.d3] : undefined)
  const latestPeriod = settlement?.targetPeriod || latestDrawData?.period || overview.data.latestPeriod || '—'
  const latestDate = settlement?.drawDate || latestDrawData?.draw_date || overview.data.latestDrawDate
  const isHit = (settlement?.winningTickets ?? 0) > 0
  const stake = prediction?.payouts.stake || 2
  const ticketCount = prediction?.query.tickets || 0
  return (
    <div className="page-stack">
      <section className="draw-hero">
        <div className="draw-hero-main">
          <span className="eyebrow">最新开奖</span>
          <div className="draw-period">
            第 <b>{latestPeriod}</b> 期
          </div>
          <div className="draw-balls">
            {latestNumbers && latestNumbers.length ? (
              latestNumbers.map((number, index) => <NumberBall key={index} value={String(number)} />)
            ) : (
              <span className="vs">暂无开奖号码</span>
            )}
          </div>
          <div className="draw-date">开奖日期：{formatDate(latestDate)}</div>
        </div>
        <div className="draw-hero-side">
          <div className={`result-badge ${settlement ? (isHit ? 'hit' : 'miss') : ''}`}>
            <span className="rb-label">本预测结算</span>
            <span className="rb-value">
              {settlement ? (isHit ? `命中 ${settlement.winningTickets} 注` : '未命中') : '待开奖'}
            </span>
          </div>
          <div className="result-badge">
            <span className="rb-label">投入 / 回报</span>
            <span className="rb-value">
              ¥{stake * ticketCount} / ¥{settlement?.returnAmount ?? 0}
            </span>
          </div>
        </div>
      </section>

      <section className="summary-band">
        <div>
          <span className="eyebrow">排列3 下一期开奖研究</span>
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
            <Metric
              label="未解决冲突"
              value={`${overview.data.conflictRecords}`}
              tone={overview.data.conflictRecords > 0 ? 'danger' : 'good'}
            />
            <Metric label="双源覆盖率" value={pct(overview.data.dualSourceCoverage)} />
          </div>
        </Panel>
        <Panel title="当前复盘" icon={<Trophy size={18} />}>
          <div className="info-rows">
            <Info label="预测 ID" value={prediction?.predictionId.slice(0, 16) || '暂无'} />
            <Info label="绑定期号" value={settlement?.targetPeriod || '等待下一期开奖'} />
            <Info label="开奖号码" value={latestNumbers?.join(',') || '暂无'} />
            <Info label="生成时间" value={formatTime(prediction?.generatedAt)} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function ReportsPage({ reports }: { reports: DailyReportSummary[] }) {
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [pageIdx, setPageIdx] = useState(0)
  const pageSize = 8
  useEffect(() => {
    if (!selected && reports[0]) setSelected(reports[0].runId)
  }, [reports, selected])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return reports
    return reports.filter((r) => `${r.day} ${r.afterPeriod} ${r.runId}`.toLowerCase().includes(q))
  }, [reports, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(pageIdx, pageCount - 1)
  const pageItems = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const { data, loading } = useApi<ReportDetail>(selected ? `/api/v1/reports/${encodeURIComponent(selected)}` : '', [
    selected,
  ])

  const exportMd = () => {
    if (!data) return
    const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.summary.day}-${data.summary.afterPeriod}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="reports-layout">
      <aside className="report-list">
        <div className="report-toolbar">
          <input
            className="report-search"
            placeholder="搜索日期 / 期号 / ID"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPageIdx(0)
            }}
          />
        </div>
        {pageItems.map((report) => (
          <button
            key={report.runId}
            className={selected === report.runId ? 'active' : ''}
            onClick={() => setSelected(report.runId)}
          >
            <span>{report.day}</span>
            <strong>{report.afterPeriod} 期后</strong>
            <small>{report.runId}</small>
          </button>
        ))}
        {pageCount > 1 ? (
          <div className="pager">
            <button disabled={safePage === 0} onClick={() => setPageIdx(safePage - 1)}>
              上一页
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPageIdx(safePage + 1)}>
              下一页
            </button>
          </div>
        ) : null}
      </aside>
      <section className="report-detail">
        {loading && !data ? (
          <main className="loading">加载日报</main>
        ) : data ? (
          <>
            <div className="report-detail-head">
              <h2>{data.summary.day} 日报</h2>
              <button className="export-btn" onClick={exportMd}>
                导出 Markdown
              </button>
            </div>
            <div className="metric-list compact">
              <Metric label="生成时间" value={formatTime(data.summary.generatedAt)} />
              <Metric label="训练期数" value={`${data.payload.prediction.training.recordCount}`} />
              <Metric label="数据状态" value={formatTrainingDataStatus(data.payload.prediction.training.dataStatus)} />
              <Metric label="玩法" value={playLabel(data.payload.prediction.query.playType)} />
              <Metric
                label="当前复盘"
                value={statusLabel(String((data.currentSettlement as { status?: string } | null)?.status || 'pending'))}
              />
            </div>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.markdown) }} />
          </>
        ) : (
          <Empty title="请选择日报" />
        )}
      </section>
    </div>
  )
}

function BacktestPage({ prediction }: { prediction: PredictionPayload | null }) {
  const backtest = prediction?.backtest
  const hasBacktest = !!backtest && backtest.status === 'complete' && typeof backtest.roi === 'number'
  const costReturnOption = useMemo(
    () => ({
      tooltip: {},
      grid: { left: 64, right: 20, top: 36, bottom: 32 },
      title: { text: '成本 vs 回报（元）', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: { type: 'category', data: ['历史模拟成本', '历史模拟回报'] },
      yAxis: { type: 'value', name: '元' },
      series: [
        {
          type: 'bar',
          data: [backtest?.totalCost || 0, backtest?.totalReturn || 0],
          itemStyle: { color: '#1677ff' },
          label: { show: true, position: 'top' },
        },
      ],
    }),
    [backtest],
  )

  const roiOption = useMemo(() => {
    const modelRoi = typeof backtest?.roi === 'number' ? Math.round(backtest.roi * 10000) / 100 : 0
    const baselineRoi =
      typeof backtest?.baseline?.expectedRoi === 'number'
        ? Math.round(backtest.baseline.expectedRoi * 10000) / 100
        : null
    const names = baselineRoi !== null ? ['本模型', '理论随机基线'] : ['本模型']
    const values = baselineRoi !== null ? [modelRoi, baselineRoi] : [modelRoi]
    return {
      tooltip: { valueFormatter: (value: number) => `${value}%` },
      grid: { left: 52, right: 20, top: 36, bottom: 32 },
      title: { text: '历史模拟 ROI（%）', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: { type: 'category', data: names },
      yAxis: { type: 'value', name: '%' },
      series: [
        {
          type: 'bar',
          data: values,
          itemStyle: { color: (params: { dataIndex: number }) => (params.dataIndex === 0 ? '#c01f2f' : '#8c9bab') },
          label: { show: true, position: 'top', formatter: '{c}%' },
        },
      ],
    }
  }, [backtest])

  if (!prediction) return <main className="loading">等待预测数据</main>
  return (
    <div className="page-stack">
      <Panel title="Walk-forward 回测" icon={<BarChart3 size={18} />}>
        <div className="metric-list">
          <Metric label="状态" value={statusLabel(backtest?.status || '暂无')} />
          <Metric label="测试折数" value={backtest?.cases?.length || 0} />
          <Metric label="历史模拟 ROI" value={hasBacktest ? `${(backtest!.roi! * 100).toFixed(2)}%` : '暂无'} />
          <Metric label="单注成本" value={`${prediction?.payouts.stake || 2} 元`} />
        </div>
        {hasBacktest ? (
          <>
            <Chart option={costReturnOption} />
            <Chart option={roiOption} />
            <p className="muted-text">
              ROI
              为历史模拟，不代表未来表现。"理论随机基线"按排列3固定赔率与中奖概率计算，用于对照模型相对纯随机策略的提升。
            </p>
          </>
        ) : (
          <p className="muted-text">
            当前预测尚无完整回测数据（状态：{statusLabel(backtest?.status || '暂无')}），无法进行 walk-forward
            回测展示。
          </p>
        )}
        <p className="muted-text">{prediction?.payouts.note || 'ROI 仅为历史模拟，不代表未来表现。'}</p>
      </Panel>
    </div>
  )
}

function QualityPage({ overview }: { overview: Overview }) {
  const option = useMemo(
    () => ({
      tooltip: {},
      legend: { bottom: 0 },
      grid: { left: 48, right: 24, top: 24, bottom: 56 },
      xAxis: { type: 'category', data: ['双源确认', '单来源', '未解决冲突'] },
      yAxis: { type: 'value' },
      series: [
        {
          name: '记录数',
          type: 'bar',
          data: [overview.data.confirmedRecords, overview.data.singleSourceRecords, overview.data.conflictRecords],
          itemStyle: { color: (params: { dataIndex: number }) => ['#00a870', '#faad14', '#d93026'][params.dataIndex] },
        },
      ],
    }),
    [overview],
  )
  return (
    <div className="page-stack">
      <Panel title="数据质量概览" icon={<Database size={18} />}>
        <Chart option={option} />
        <div className="info-rows">
          <Info label="最新开奖日期" value={formatDate(overview.data.latestDrawDate)} />
          <Info label="数据目录状态" value={overview.data.usableRecords >= 100 ? '可用于普通预测' : '数据不足'} />
          <Info
            label="正式实验门槛"
            value={overview.data.confirmedRecords >= 2000 ? '满足最近 2000 confirmed 要求' : 'confirmed 数据不足 2000'}
          />
        </div>
        {overview.data.confidenceByYear.length > 0 && (
          <table className="data-table compact">
            <thead>
              <tr>
                <th>年份</th>
                <th>期数</th>
                <th>确认</th>
                <th>单来源</th>
                <th>冲突</th>
                <th>双源覆盖率</th>
              </tr>
            </thead>
            <tbody>
              {overview.data.confidenceByYear.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}年</td>
                  <td>{row.totalPeriods}</td>
                  <td>{row.confirmedRecords}</td>
                  <td>{row.singleSourceRecords}</td>
                  <td>{row.conflictRecords}</td>
                  <td>{pct(row.dualSourceCoverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {overview.data.slaEvidence.total > 0 && (
          <div className="info-rows">
            <Info
              label="SLA 时间证据"
              value={`${overview.data.slaEvidence.verifiedBeforeObservation}/${overview.data.slaEvidence.total} 条预测早于目标期首次 observation`}
            />
            <Info label="SLA 违规" value={`${overview.data.slaEvidence.violated} 条（晚于首次 observation）`} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function OpsPage({ runs, operations }: { runs: OnlineRun[]; operations: Operation[] }) {
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [openEvent, setOpenEvent] = useState<number | null>(null)
  const duration = (start?: string | null, end?: string | null) => {
    if (!start || !end) return '—'
    const ms = new Date(end).getTime() - new Date(start).getTime()
    return ms >= 0 ? `${(ms / 1000).toFixed(1)} 秒` : '—'
  }
  return (
    <div className="two-column">
      <Panel title="预测运行" icon={<CalendarClock size={18} />}>
        <div className="timeline">
          {runs.map((run) => {
            const open = openRun === run.runId
            return (
              <div
                className={`timeline-item ${run.status} clickable`}
                key={run.runId}
                onClick={() => setOpenRun(open ? null : run.runId)}
              >
                <strong>
                  {statusLabel(run.status)} · {run.afterPeriod || '未知期号'}
                </strong>
                <span>{formatTime(run.startedAt)}</span>
                {run.errorMessage ? <small>{run.errorMessage}</small> : null}
                {open ? (
                  <div className="ops-detail">
                    <div className="info-row">
                      <span>运行 ID</span>
                      <strong>{run.runId}</strong>
                    </div>
                    <div className="info-row">
                      <span>绑定期号</span>
                      <strong>{run.afterPeriod || '—'}</strong>
                    </div>
                    <div className="info-row">
                      <span>开始</span>
                      <strong>{formatTime(run.startedAt)}</strong>
                    </div>
                    <div className="info-row">
                      <span>结束</span>
                      <strong>{formatTime(run.completedAt)}</strong>
                    </div>
                    <div className="info-row">
                      <span>耗时</span>
                      <strong>{duration(run.startedAt, run.completedAt)}</strong>
                    </div>
                    <div className="info-row">
                      <span>错误信息</span>
                      <strong>{run.errorMessage || '无'}</strong>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Panel>
      <Panel title="系统事件" icon={<Activity size={18} />}>
        <div className="timeline">
          {operations.map((event) => {
            const open = openEvent === event.eventId
            const detail = event.details || {}
            return (
              <div
                className={`timeline-item ${event.level} clickable`}
                key={event.eventId}
                onClick={() => setOpenEvent(open ? null : event.eventId)}
              >
                <strong>{event.message}</strong>
                <span>
                  {formatTime(event.createdAt)} · {event.eventType}
                </span>
                {open ? (
                  <div className="ops-detail">
                    <div className="info-row">
                      <span>类型</span>
                      <strong>{event.eventType}</strong>
                    </div>
                    <div className="info-row">
                      <span>级别</span>
                      <strong>{event.level}</strong>
                    </div>
                    <div className="info-row">
                      <span>时间</span>
                      <strong>{formatTime(event.createdAt)}</strong>
                    </div>
                    {Object.entries(detail).map(([key, value]) => (
                      <div className="info-row" key={key}>
                        <span>{key}</span>
                        <strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton">
      {Array.from({ length: lines }).map((_, index) => (
        <div className="skeleton-line" key={index} style={{ width: `${92 - index * 8}%` }} />
      ))}
    </div>
  )
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <main className="error-shell">
          <div className="error-card">
            <h2>页面渲染出错</h2>
            <p>{this.state.error.message}</p>
            <button onClick={() => this.setState({ error: null })}>重试</button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

function ExperimentsPage({ experiments, onOpen }: { experiments: Experiment[]; onOpen: (id: string) => void }) {
  if (!experiments.length) return <Empty title="暂无实验（运行 data experiment create 后会出现在这里）" />
  return (
    <div className="page-stack">
      <Panel title="排列3 实验评估" icon={<FlaskConical size={18} />}>
        <p className="muted-text">
          基于嵌套 walk-forward 的可复现评估：相同 spec + snapshot + 代码 commit + 随机种子 → 相同实验 ID 与报告哈希。
        </p>
        <div className="experiment-list">
          {experiments.map((experiment) => (
            <button
              key={experiment.experimentId}
              className="experiment-card"
              onClick={() => onOpen(experiment.experimentId)}
            >
              <div className="experiment-head">
                <strong>{experiment.name}</strong>
                <span className={`status-badge ${experiment.status}`}>{statusLabel(experiment.status)}</span>
              </div>
              <div className="experiment-meta">
                <span>模式 {experiment.mode}</span>
                <span>主指标 {experiment.spec?.primaryMetric || 'normalizedRank.mean'}</span>
                <span>模型 {(experiment.spec?.models || []).join(' / ') || '—'}</span>
              </div>
              <div className="experiment-foot">
                <code>{experiment.experimentId.slice(0, 16)}…</code>
                <span>{formatTime(experiment.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function ExperimentDetail({ experimentId, onBack }: { experimentId: string; onBack: () => void }) {
  const { data, loading, error } = useApi<ExperimentDetail>(`/api/v1/experiments/${encodeURIComponent(experimentId)}`, [
    experimentId,
  ])
  if (loading && !data) return <main className="loading">加载实验详情</main>
  if (error)
    return (
      <main className="error-shell">
        <div className="error-card">
          <h2>加载失败</h2>
          <p>{error}</p>
          <button onClick={onBack}>返回</button>
        </div>
      </main>
    )
  if (!data) return <Empty title="未找到实验" />
  const completedFolds = data.folds.filter((fold) => fold.status === 'complete')
  return (
    <div className="page-stack">
      <button className="back-link" onClick={onBack}>
        ← 返回实验列表
      </button>
      <Panel title={data.experiment.name} icon={<FlaskConical size={18} />}>
        <div className="info-rows">
          <Info label="实验 ID" value={data.experiment.experimentId.slice(0, 24)} />
          <Info label="状态" value={statusLabel(data.experiment.status)} />
          <Info label="模式" value={data.experiment.mode} />
          <Info label="数据 snapshot" value={data.experiment.datasetSnapshotId.slice(0, 16)} />
          <Info label="spec 哈希" value={data.experiment.specHash.slice(0, 16)} />
          <Info label="代码 commit" value={data.experiment.codeCommit || '—'} />
        </div>
        {data.experiment.spec?.hypothesis ? (
          <p className="experiment-hypothesis">研究假设：{String(data.experiment.spec.hypothesis)}</p>
        ) : null}
      </Panel>
      <Panel
        title={`Walk-forward 折（${completedFolds.length}/${data.folds.length} 完成）`}
        icon={<BarChart3 size={18} />}
      >
        {data.folds.length === 0 ? (
          <p className="muted-text">尚未运行开发折。执行 data experiment run 后，此处展示各折的训练/测试区间与指标。</p>
        ) : (
          <div className="fold-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>层级</th>
                  <th>#</th>
                  <th>训练区间</th>
                  <th>测试区间</th>
                  <th>状态</th>
                  <th>指标</th>
                </tr>
              </thead>
              <tbody>
                {data.folds.map((fold) => {
                  let metrics: Record<string, number> = {}
                  try {
                    if (fold.metricsJson) metrics = JSON.parse(fold.metricsJson)
                  } catch {
                    /* 忽略不可解析的指标 */
                  }
                  return (
                    <tr key={`${fold.foldLevel}-${fold.foldIndex}`}>
                      <td>{fold.foldLevel}</td>
                      <td>{fold.foldIndex}</td>
                      <td>
                        {fold.trainFromPeriod}–{fold.trainToPeriod}
                      </td>
                      <td>
                        {fold.testFromPeriod}–{fold.testToPeriod}
                      </td>
                      <td>
                        <span className={`status-badge ${fold.status}`}>{statusLabel(fold.status)}</span>
                      </td>
                      <td className="metrics-cell">
                        {Object.entries(metrics)
                          .slice(0, 4)
                          .map(([key, value]) => (
                            <span key={key}>
                              {key}: {typeof value === 'number' ? value.toFixed(4) : value}
                            </span>
                          ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="审计轨迹" icon={<Activity size={18} />}>
        <div className="timeline">
          {data.audit.map((entry, index) => (
            <div className={`timeline-item ${entry.status}`} key={index}>
              <strong>
                {entry.action} · {statusLabel(entry.status)}
              </strong>
              <span>{formatTime(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function SnapshotsPage({ snapshots, onOpen }: { snapshots: DatasetSnapshotSummary[]; onOpen: (id: string) => void }) {
  if (!snapshots.length) return <Empty title="暂无数据集快照（运行 data snapshot create 后会出现在这里）" />
  return (
    <div className="page-stack">
      <Panel title="数据集快照" icon={<Database size={18} />}>
        <p className="muted-text">
          不可变 confirmed-only 数据集快照：相同从/截止期号与数据 → 相同 snapshotId 与
          dataHash；实验必须绑定快照并记录代码 commit。
        </p>
        <div className="experiment-list">
          {snapshots.map((snapshot) => (
            <button key={snapshot.snapshotId} className="snapshot-card" onClick={() => onOpen(snapshot.snapshotId)}>
              <div className="experiment-head">
                <code>{snapshot.snapshotId.slice(0, 16)}…</code>
                <span className="status-badge">
                  {typeof snapshot.verified === 'boolean' ? (snapshot.verified ? '验证通过' : '验证失败') : '未验证'}
                </span>
              </div>
              <div className="experiment-meta">
                <span>
                  {snapshot.fromPeriod} → {snapshot.afterPeriod}
                </span>
                <span>{snapshot.recordCount} 期</span>
                <span>{snapshot.codeCommit ? snapshot.codeCommit.slice(0, 12) : '—'}</span>
              </div>
              <div className="experiment-foot">
                <span>{formatTime(snapshot.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function SnapshotDetail({ snapshotId, onBack }: { snapshotId: string; onBack: () => void }) {
  const { data, loading, error } = useApi<SnapshotDetail>(`/api/v1/snapshots/${encodeURIComponent(snapshotId)}`, [
    snapshotId,
  ])
  if (loading && !data) return <main className="loading">加载快照详情</main>
  if (error)
    return (
      <main className="error-shell">
        <div className="error-card">
          <h2>加载失败</h2>
          <p>{error}</p>
          <button onClick={onBack}>返回</button>
        </div>
      </main>
    )
  if (!data) return <Empty title="未找到快照" />
  return (
    <div className="page-stack">
      <button className="back-link" onClick={onBack}>
        ← 返回快照列表
      </button>
      <Panel title="数据集快照详情" icon={<Database size={18} />}>
        <div className="info-rows">
          <Info label="快照 ID" value={data.snapshot.snapshotId.slice(0, 24)} />
          <Info label="期号范围" value={`${data.snapshot.fromPeriod} – ${data.snapshot.afterPeriod}`} />
          <Info label="记录数" value={String(data.snapshot.recordCount)} />
          <Info label="数据哈希" value={data.snapshot.dataHash.slice(0, 24)} />
          <Info label="代码 commit" value={data.snapshot.codeCommit ? data.snapshot.codeCommit.slice(0, 16) : '—'} />
        </div>
        {data.verification && (
          <div className={`verify-banner ${data.verification.valid ? 'ok' : 'bad'}`}>
            {data.verification.valid
              ? `哈希校验通过：实际 ${data.verification.actualRecordCount} 期与记录数一致。`
              : `哈希校验失败：期望 ${data.verification.expectedRecordCount} 期，实际 ${data.verification.actualRecordCount} 期。`}
          </div>
        )}
      </Panel>
      <Panel title={`绑定实验（${data.experiments.length}）`} icon={<FlaskConical size={18} />}>
        {data.experiments.length === 0 ? (
          <p className="muted-text">尚无实验绑定此快照。</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>实验</th>
                <th>模式</th>
                <th>状态</th>
                <th>报告</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {data.experiments.map((experiment) => (
                <tr key={experiment.experimentId}>
                  <td>
                    <code>{experiment.experimentId.slice(0, 16)}…</code> {experiment.name}
                  </td>
                  <td>{experiment.mode}</td>
                  <td>
                    <span className={`status-badge ${experiment.status}`}>{statusLabel(experiment.status)}</span>
                  </td>
                  <td>{experiment.reportHash ? experiment.reportHash.slice(0, 16) : '尚未生成'}</td>
                  <td>{formatTime(experiment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function LedgerPage({ ledger }: { ledger: { rows: LedgerRow[]; totals: LedgerTotals } | null }) {
  const trends = useApi<TrendSeries>('/api/v1/trends', [])
  const cumulativeProfitOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 64, right: 20, top: 36, bottom: 48 },
      title: { text: '累计净收益（元）', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: {
        type: 'category',
        data: trends.data?.cumulativeProfit.map((point) => point.period) || [],
        axisLabel: { rotate: 45 },
      },
      yAxis: { type: 'value', name: '元' },
      series: [
        {
          type: 'line',
          smooth: true,
          data: trends.data?.cumulativeProfit.map((point) => point.value) || [],
          itemStyle: { color: '#c01f2f' },
          areaStyle: { opacity: 0.08 },
        },
      ],
    }),
    [trends.data],
  )

  const hitRateOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${(value * 100).toFixed(1)}%` },
      grid: { left: 56, right: 20, top: 36, bottom: 48 },
      title: { text: '累计命中率', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: {
        type: 'category',
        data: trends.data?.hitRate.map((point) => point.period) || [],
        axisLabel: { rotate: 45 },
      },
      yAxis: {
        type: 'value',
        name: '%',
        max: 1,
        axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          data: trends.data?.hitRate.map((point) => point.value) || [],
          itemStyle: { color: '#1677ff' },
          areaStyle: { opacity: 0.08 },
        },
      ],
    }),
    [trends.data],
  )

  if (!ledger) return <main className="loading">等待账本数据</main>
  const total = ledger.totals
  return (
    <div className="page-stack">
      <Panel title="收益与命中趋势" icon={<TrendingUp size={18} />}>
        {trends.loading && !trends.data ? (
          <Skeleton lines={4} />
        ) : trends.data && trends.data.count > 0 ? (
          <>
            <Chart option={cumulativeProfitOption} />
            <Chart option={hitRateOption} />
          </>
        ) : (
          <p className="muted-text">尚无足够预测记录生成趋势（需要多期结算数据）。</p>
        )}
      </Panel>
      <Panel title="结算汇总" icon={<Trophy size={18} />}>
        <div className="metric-list">
          <Metric label="累计净收益" value={`¥${total.profit}`} tone={total.profit >= 0 ? 'good' : 'danger'} />
          <Metric label="累计命中注数" value={`${total.winning}`} />
          <Metric label="命中期数" value={`${total.hits}`} />
          <Metric label="结算记录数" value={`${ledger.rows.length}`} />
        </div>
      </Panel>
      <Panel title="逐期结算历史" icon={<CalendarClock size={18} />}>
        {ledger.rows.length === 0 ? (
          <Empty title="暂无结算记录" />
        ) : (
          <div className="fold-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>截止期</th>
                  <th>目标期</th>
                  <th>开奖号码</th>
                  <th>状态</th>
                  <th>命中</th>
                  <th>回报</th>
                  <th>净收益</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((row) => (
                  <tr key={row.predictionId}>
                    <td>{row.afterPeriod}</td>
                    <td>{row.targetPeriod || '—'}</td>
                    <td>{row.actualNumbers ? row.actualNumbers.join(' ') : '—'}</td>
                    <td>
                      <span className={`status-badge ${row.status}`}>{statusLabel(row.status)}</span>
                    </td>
                    <td>{row.winningTickets}</td>
                    <td>¥{row.returnAmount}</td>
                    <td className={row.profit >= 0 ? 'pos' : 'neg'}>
                      {row.profit >= 0 ? '+' : ''}
                      {row.profit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

const POS_LABELS = ['百位', '十位', '个位'] as const

function roadOf(d: number): 0 | 1 | 2 {
  return (d % 3) as 0 | 1 | 2
}

function TrendsAnalysisPage({ draws }: { draws: DrawRow[] }) {
  const [windowSize, setWindowSize] = useState(100)
  const chron = useMemo(
    () => draws.slice(0, windowSize).reverse(), // 原始为倒序，取窗口后翻为正序
    [draws, windowSize],
  )

  const analysis = useMemo(() => {
    const window = chron
    const roadDist: Array<[number, number, number]> = [0, 0, 0].map(() => [0, 0, 0]) as Array<[number, number, number]>
    const digitHeat: number[][] = [[], [], []].map(() => new Array(10).fill(0))
    const roadTrend: Array<{ period: string; b: number; s: number; g: number }> = []
    const sumTrend: Array<{ period: string; sum: number; span: number }> = []
    for (const draw of window) {
      const digits = [draw.d1, draw.d2, draw.d3]
      digits.forEach((digit, pos) => {
        roadDist[pos][roadOf(digit)] += 1
        digitHeat[pos][digit] += 1
      })
    }
    const trendWindow = window.slice(-50)
    for (const draw of trendWindow) {
      roadTrend.push({ period: draw.period, b: roadOf(draw.d1), s: roadOf(draw.d2), g: roadOf(draw.d3) })
    }
    const sumWindow = window.slice(-100)
    for (const draw of sumWindow) {
      const sum = draw.d1 + draw.d2 + draw.d3
      sumTrend.push({
        period: draw.period,
        sum,
        span: Math.max(draw.d1, draw.d2, draw.d3) - Math.min(draw.d1, draw.d2, draw.d3),
      })
    }
    // 连续全 0 路（自最近一期向前数）
    let consecutiveAllZero = 0
    for (const draw of draws) {
      if (roadOf(draw.d1) === 0 && roadOf(draw.d2) === 0 && roadOf(draw.d3) === 0) consecutiveAllZero += 1
      else break
    }
    // 最近两期共用数字
    const lastTwo = draws.slice(0, 2).map((draw) => new Set([draw.d1, draw.d2, draw.d3]))
    const shared = lastTwo.length === 2 ? [...lastTwo[0]].filter((digit) => lastTwo[1].has(digit)) : []
    // 最热 / 最冷数字（按位置合计）
    const totalByDigit = new Array(10).fill(0)
    digitHeat.forEach((row) =>
      row.forEach((count, digit) => {
        totalByDigit[digit] += count
      }),
    )
    const maxCount = Math.max(...totalByDigit)
    const minCount = Math.min(...totalByDigit.filter((c) => c > 0))
    const hottest = totalByDigit
      .map((c, d) => ({ d, c }))
      .filter((x) => x.c === maxCount)
      .map((x) => x.d)
    const coldest = totalByDigit
      .map((c, d) => ({ d, c }))
      .filter((x) => x.c === minCount)
      .map((x) => x.d)
    return { roadDist, digitHeat, roadTrend, sumTrend, consecutiveAllZero, shared, hottest, coldest, maxCount }
  }, [chron, draws])

  const roadBarOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 28 },
      title: {
        text: `012路占比（近 ${windowSize} 期）`,
        left: 'center',
        textStyle: { fontSize: 14, color: '#172026' },
      },
      xAxis: { type: 'category', data: POS_LABELS },
      yAxis: { type: 'value', name: '出现次数' },
      color: ['#c01f2f', '#1677ff', '#52a83a'],
      series: [
        { name: '0路', type: 'bar', stack: 'total', data: analysis.roadDist.map((row) => row[0]) },
        { name: '1路', type: 'bar', stack: 'total', data: analysis.roadDist.map((row) => row[1]) },
        { name: '2路', type: 'bar', stack: 'total', data: analysis.roadDist.map((row) => row[2]) },
      ],
    }),
    [analysis, windowSize],
  )

  const roadTrendOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 36, right: 16, top: 36, bottom: 48 },
      title: { text: '012路走势（近 50 期）', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: {
        type: 'category',
        data: analysis.roadTrend.map((p) => p.period),
        axisLabel: { rotate: 60, fontSize: 9 },
      },
      yAxis: { type: 'value', name: '路数', min: 0, max: 2, interval: 1 },
      color: ['#c01f2f', '#1677ff', '#52a83a'],
      series: [
        { name: '百位路', type: 'line', step: 'middle', data: analysis.roadTrend.map((p) => p.b) },
        { name: '十位路', type: 'line', step: 'middle', data: analysis.roadTrend.map((p) => p.s) },
        { name: '个位路', type: 'line', step: 'middle', data: analysis.roadTrend.map((p) => p.g) },
      ],
    }),
    [analysis],
  )

  const heatOption = useMemo(
    () => ({
      tooltip: {
        position: 'top',
        formatter: (params: { value: [number, number, number] }) =>
          `${POS_LABELS[params.value[1]]} · 数字${params.value[0]}：出现 ${params.value[2]} 次`,
      },
      grid: { left: 52, right: 16, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: [...Array(10).keys()].map(String), name: '数字', splitArea: { show: true } },
      yAxis: { type: 'category', data: POS_LABELS, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: Math.max(1, analysis.maxCount),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#eef3f8', '#9cc4e8', '#c01f2f'] },
      },
      series: [
        {
          type: 'heatmap',
          data: POS_LABELS.flatMap((_, pos) =>
            [...Array(10).keys()].map((digit) => [digit, pos, analysis.digitHeat[pos][digit]]),
          ),
          label: { show: true },
        },
      ],
    }),
    [analysis],
  )

  const sumOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 36, bottom: 48 },
      title: { text: '和值走势（近 100 期）', left: 'center', textStyle: { fontSize: 14, color: '#172026' } },
      xAxis: { type: 'category', data: analysis.sumTrend.map((p) => p.period), axisLabel: { rotate: 60, fontSize: 9 } },
      yAxis: { type: 'value', name: '和值', min: 0, max: 27 },
      series: [
        {
          type: 'line',
          smooth: true,
          data: analysis.sumTrend.map((p) => p.sum),
          itemStyle: { color: '#c01f2f' },
          areaStyle: { opacity: 0.08 },
        },
      ],
    }),
    [analysis],
  )

  if (draws.length === 0) return <main className="loading">等待开奖数据</main>

  return (
    <div className="page-stack">
      <div className="analysis-bar">
        <span className="muted-text">分析窗口</span>
        {[50, 100, 200].map((size) => (
          <button
            key={size}
            className={`chip-btn ${windowSize === size ? 'active' : ''}`}
            onClick={() => setWindowSize(size)}
          >
            {size} 期
          </button>
        ))}
      </div>

      <div className="insight-row">
        <div className="insight-card">
          <span>连续全 0 路</span>
          <strong className={analysis.consecutiveAllZero >= 2 ? 'warn' : ''}>{analysis.consecutiveAllZero} 期</strong>
        </div>
        <div className="insight-card">
          <span>最近两期共用数字</span>
          <strong>{analysis.shared.length ? analysis.shared.join('、') : '无'}</strong>
        </div>
        <div className="insight-card">
          <span>最活跃数字</span>
          <strong className="good">{analysis.hottest.join('、')}</strong>
        </div>
        <div className="insight-card">
          <span>最冷数字</span>
          <strong className="muted">{analysis.coldest.join('、')}</strong>
        </div>
      </div>

      <Panel title="012路分布偏态" icon={<LineChartIcon size={18} />}>
        <Chart option={roadBarOption} />
        <p className="muted-text">
          理想均匀分布下每路约各占 1/3。若某路明显偏离，即为「路数偏态」——当前加权频率模型未捕捉该特征。
        </p>
      </Panel>
      <Panel title="012路走势" icon={<LineChartIcon size={18} />}>
        <Chart option={roadTrendOption} />
      </Panel>
      <Panel title="号码活跃度（按位置）" icon={<Database size={18} />}>
        <Chart option={heatOption} />
        <p className="muted-text">颜色越红表示该数字在对应位置上近期出现越频繁（热号），越浅越冷。</p>
      </Panel>
      <Panel title="和值走势" icon={<TrendingUp size={18} />}>
        <Chart option={sumOption} />
      </Panel>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'danger' }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        {icon}
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  )
}

function Empty({ title }: { title: string }) {
  return <div className="empty">{title}</div>
}

function parseHash(): { page: PageKey; experimentId?: string } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const parts = raw.split('/').filter(Boolean)
  const candidate = parts[0] as PageKey
  const page = navigation.some((item) => item.key === candidate) ? candidate : 'overview'
  return { page, experimentId: parts[1] || undefined }
}

function App() {
  const initial = parseHash()
  const [page, setPage] = useState<PageKey>(initial.page)
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(initial.experimentId || null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionTick, setSessionTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number>(() => Date.now())
  const [nowTick, setNowTick] = useState(0)
  const session = useApi<{ authenticated: boolean; accessMode: 'tunnel' | 'public'; authRequired: boolean }>(
    '/api/v1/session',
    [sessionTick],
  )
  const overview = useApi<Overview>('/api/v1/overview', [sessionTick])
  const reports = useApi<{ reports: DailyReportSummary[] }>('/api/v1/reports?limit=30', [sessionTick])
  const ops = useApi<{ runs: OnlineRun[]; operations: Operation[] }>('/api/v1/operations?limit=30', [sessionTick])
  const experiments = useApi<{ experiments: Experiment[] }>('/api/v1/experiments?limit=30', [sessionTick])
  const snapshots = useApi<{ snapshots: DatasetSnapshotSummary[] }>('/api/v1/snapshots', [sessionTick])
  const ledger = useApi<{ rows: LedgerRow[]; totals: LedgerTotals }>('/api/v1/ledger', [sessionTick])
  const draws = useApi<{ draws: DrawRow[]; count: number }>('/api/v1/draws?limit=600', [sessionTick])

  const navigate = (next: PageKey, experimentId?: string) => {
    const hash = experimentId ? `#/${next}/${experimentId}` : `#/${next}`
    if (window.location.hash === hash) {
      const parsed = parseHash()
      setPage(parsed.page)
      setSelectedExperiment(parsed.experimentId || null)
    } else {
      window.location.hash = hash
    }
  }

  const reloadAll = async () => {
    setRefreshing(true)
    await Promise.all([
      overview.reload(),
      reports.reload(),
      ops.reload(),
      experiments.reload(),
      snapshots.reload(),
      ledger.reload(),
      draws.reload(),
    ])
    setRefreshing(false)
    setLastUpdated(Date.now())
  }

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash()
      setPage(parsed.page)
      setSelectedExperiment(parsed.experimentId || null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNowTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // 每 5 分钟自动拉取一次，使最新开奖与结算保持更新
  useEffect(() => {
    const timer = setInterval(() => {
      void reloadAll()
    }, 300000)
    return () => clearInterval(timer)
  }, [])

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
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="logo-block">
          <span>P3</span>
          <strong>排列3研究台</strong>
          <small>本地研究 · 只读</small>
          <button className="sidebar-toggle" aria-label="切换导航" onClick={() => setSidebarOpen((value) => !value)}>
            <Menu size={20} />
          </button>
        </div>
        <nav>
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => {
                  navigate(item.key)
                  setSidebarOpen(false)
                }}
              >
                <Icon size={18} /> {item.label}
              </button>
            )
          })}
        </nav>
        <div className="nav-foot">
          数据每 5 分钟自动刷新。
          <br />
          最新开奖以官方公布为准。
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div className="title-block">
            <strong>Lotterymcp 排列3研究台</strong>
            <span className="freshness-chip">
              <span className="dot" />
              {overview.data ? `数据更新于 ${relativeTime(lastUpdated, nowTick)}` : '等待数据'}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              onClick={() => {
                void reloadAll()
              }}
              title="刷新数据"
              disabled={refreshing}
            >
              {refreshing ? <span className="spinner spinner-sm" /> : <RefreshCw size={18} />}
            </button>
            {session.data?.authRequired ? (
              <button onClick={logout} title="退出登录">
                <LogOut size={18} />
              </button>
            ) : null}
          </div>
        </header>
        {overview.error ? <div className="error-line">{overview.error}</div> : null}
        {!overview.data ? (
          <main className="loading">等待排列3数据</main>
        ) : (
          <ErrorBoundary>
            {page === 'overview' ? <OverviewPage overview={overview.data} /> : null}
            {page === 'reports' ? <ReportsPage reports={reports.data?.reports || []} /> : null}
            {page === 'backtest' ? <BacktestPage prediction={overview.data.latestPrediction} /> : null}
            {page === 'quality' ? <QualityPage overview={overview.data} /> : null}
            {page === 'experiments' ? (
              selectedExperiment ? (
                <ExperimentDetail experimentId={selectedExperiment} onBack={() => navigate('experiments')} />
              ) : (
                <ExperimentsPage
                  experiments={experiments.data?.experiments || []}
                  onOpen={(id) => navigate('experiments', id)}
                />
              )
            ) : null}
            {page === 'snapshots' ? (
              selectedExperiment ? (
                <SnapshotDetail snapshotId={selectedExperiment} onBack={() => navigate('snapshots')} />
              ) : (
                <SnapshotsPage snapshots={snapshots.data?.snapshots || []} onOpen={(id) => navigate('snapshots', id)} />
              )
            ) : null}
            {page === 'ledger' ? <LedgerPage ledger={ledger.data} /> : null}
            {page === 'analysis' ? <TrendsAnalysisPage draws={draws.data?.draws || []} /> : null}
            {page === 'ops' ? <OpsPage runs={ops.data?.runs || []} operations={ops.data?.operations || []} /> : null}
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

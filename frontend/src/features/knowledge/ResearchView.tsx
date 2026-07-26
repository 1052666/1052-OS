import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  DatabaseZap,
  ExternalLink,
  FileSearch,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ResearchAssessment,
  ResearchClaim,
  ResearchResult,
  ResearchState,
} from '../../contracts/schemas'
import { researchApi } from '../../data/api'
import {
  AsyncState,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Select,
  Surface,
  Textarea,
  uiStyles,
} from '../../components/ui'
import styles from './research.module.css'

type EvidenceCandidate = {
  resultId: string
  resultUrl: string
  quote: string
  charStart: number
  charEnd: number
  contentHash: string
  sourceClusterId: string
  similarity: number
}

type ClaimRisk = 'low' | 'medium' | 'high'
type EvidenceStance = 'support' | 'refute' | 'insufficient'

function formatDate(value: number) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function resultTone(status: ResearchResult['status']): 'default' | 'success' | 'danger' {
  return status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'default'
}

function qualityTone(
  verdict: ResearchAssessment['quality']['verdict'],
): 'success' | 'warning' | 'danger' {
  return verdict === 'good' ? 'success' : verdict === 'acceptable' ? 'warning' : 'danger'
}

function reviewLabel(decision?: string) {
  if (decision === 'approved') return '已通过'
  if (decision === 'rejected') return '已拒绝'
  if (decision === 'needs_review') return '需复核'
  return '未审核'
}

function reviewTone(decision?: string): 'default' | 'success' | 'warning' | 'danger' {
  if (decision === 'approved') return 'success'
  if (decision === 'rejected') return 'danger'
  if (decision === 'needs_review') return 'warning'
  return 'default'
}

function indicatorValue(value: unknown) {
  if (!value || typeof value !== 'object') return '-'
  const number = (value as Record<string, unknown>).value
  return typeof number === 'number'
    ? Number.isInteger(number) ? String(number) : number.toFixed(2)
    : '-'
}

function latestSnapshot(state: ResearchState | undefined, resultId: string) {
  return state?.snapshots.find((snapshot) => snapshot.resultId === resultId)
}

export default function ResearchView() {
  const client = useQueryClient()
  const sessions = useQuery({
    queryKey: ['research', 'sessions'],
    queryFn: researchApi.sessions,
  })
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [sessionForm, setSessionForm] = useState({ title: '', description: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [claimText, setClaimText] = useState('')
  const [claimRisk, setClaimRisk] = useState<ClaimRisk>('medium')
  const [writebackSummary, setWritebackSummary] = useState('')
  const [candidateMap, setCandidateMap] = useState<Record<string, EvidenceCandidate[]>>({})

  useEffect(() => {
    setSelectedId((current) => current || sessions.data?.sessions[0]?.id || '')
  }, [sessions.data?.sessions])

  const state = useQuery({
    queryKey: ['research', 'state', selectedId],
    queryFn: () => researchApi.state(selectedId),
    enabled: Boolean(selectedId),
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['research', 'sessions'] })
    if (selectedId) void client.invalidateQueries({ queryKey: ['research', 'state', selectedId] })
  }

  const createSession = useMutation({
    mutationFn: researchApi.createSession,
    onSuccess: (created) => {
      setSelectedId(created.id)
      setSessionForm({ title: '', description: '' })
      setCreateOpen(false)
      refresh()
    },
  })
  const searchRound = useMutation({
    mutationFn: () => researchApi.search(selectedId, { query: searchQuery, limit: 12 }),
    onSuccess: () => {
      setSearchQuery('')
      refresh()
    },
  })
  const extract = useMutation({
    mutationFn: (resultIds: string[]) => researchApi.extract(selectedId, resultIds),
    onSuccess: refresh,
  })
  const assess = useMutation({
    mutationFn: (queryId?: string) => researchApi.assess(selectedId, queryId),
    onSuccess: refresh,
  })
  const reviewResult = useMutation({
    mutationFn: (value: { resultId: string; status: ResearchResult['status'] }) =>
      researchApi.reviewResults(selectedId, [value]),
    onSuccess: refresh,
  })
  const createClaim = useMutation({
    mutationFn: () => researchApi.createClaim(selectedId, {
      text: claimText,
      riskLevel: claimRisk,
    }),
    onSuccess: () => {
      setClaimText('')
      refresh()
    },
  })
  const candidates = useMutation({
    mutationFn: (claimId: string) => researchApi.evidenceCandidates(selectedId, claimId),
    onSuccess: (data, claimId) => {
      setCandidateMap((current) => ({ ...current, [claimId]: data.candidates }))
    },
  })
  const addEvidence = useMutation({
    mutationFn: (value: {
      claimId: string
      candidate: EvidenceCandidate
      stance: EvidenceStance
    }) => researchApi.addEvidence(selectedId, value.claimId, {
      resultId: value.candidate.resultId,
      quote: value.candidate.quote,
      charStart: value.candidate.charStart,
      charEnd: value.candidate.charEnd,
      stance: value.stance,
    }),
    onSuccess: (_data, value) => {
      setCandidateMap((current) => ({
        ...current,
        [value.claimId]: (current[value.claimId] ?? []).filter(
          (item) => item.contentHash !== value.candidate.contentHash,
        ),
      }))
      refresh()
    },
  })
  const reviewClaim = useMutation({
    mutationFn: (claimId: string) => researchApi.reviewClaim(selectedId, claimId),
    onSuccess: refresh,
  })
  const writeback = useMutation({
    mutationFn: () => researchApi.writeback(selectedId, {
      title: state.data?.session.title,
      summary: writebackSummary,
      completeSession: true,
    }),
    onSuccess: () => {
      setWritebackSummary('')
      refresh()
    },
  })

  const mutationError = [
    createSession.error,
    searchRound.error,
    extract.error,
    assess.error,
    reviewResult.error,
    createClaim.error,
    candidates.error,
    addEvidence.error,
    reviewClaim.error,
    writeback.error,
  ].find(Boolean)
  const approvedClaims = useMemo(() => new Set(
    state.data?.claimReviews
      .filter((review) => review.decision === 'approved')
      .map((review) => review.claimId) ?? [],
  ), [state.data?.claimReviews])
  const sessionCompleted = state.data?.session.status === 'completed'

  return (
    <>
      <div className={styles.researchLayout}>
        <Surface
          title="研究会话"
          className={styles.sessionPane}
          action={(
            <Button size="small" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              新建
            </Button>
          )}
        >
          <AsyncState
            loading={sessions.isLoading}
            error={sessions.error}
            empty={!sessions.data?.sessions.length}
          >
            <div className={styles.sessionList}>
              {sessions.data?.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`${styles.sessionItem} ${selectedId === session.id ? styles.sessionItemActive : ''}`}
                  onClick={() => setSelectedId(session.id)}
                >
                  <span>
                    <strong>{session.title}</strong>
                    <small>{session.rounds} 轮 · {session.resultCounts.approved} 个已批准来源</small>
                  </span>
                  <Badge tone={session.status === 'completed' ? 'success' : 'default'}>
                    {session.status === 'completed' ? '已完成' : '研究中'}
                  </Badge>
                </button>
              ))}
            </div>
          </AsyncState>
        </Surface>

        <div className={styles.workspace}>
          <AsyncState loading={state.isLoading} error={state.error} empty={!selectedId}>
            {state.data ? (
              <>
                <section className={styles.researchHeader}>
                  <div>
                    <span className={styles.eyebrow}>Research session</span>
                    <h2>{state.data.session.title}</h2>
                    <p>{state.data.session.description || '围绕同一主题累积、审核并固化可验证证据。'}</p>
                  </div>
                  <div className={styles.headerStats}>
                    <span><strong>{state.data.session.rounds}</strong><small>搜索轮次</small></span>
                    <span><strong>{state.data.session.resultCounts.approved}</strong><small>批准来源</small></span>
                    <span><strong>{state.data.claims.length}</strong><small>事实主张</small></span>
                    <span><strong>{approvedClaims.size}</strong><small>通过审核</small></span>
                  </div>
                </section>

                {mutationError ? (
                  <div className={uiStyles.error}>
                    {mutationError instanceof Error ? mutationError.message : '研究操作失败'}
                  </div>
                ) : null}

                <Surface title="继续搜索">
                  <div className={styles.commandRow}>
                    <Input
                      value={searchQuery}
                      disabled={sessionCompleted}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && searchQuery.trim() && !sessionCompleted) searchRound.mutate()
                      }}
                      placeholder="输入本轮聚焦查询"
                    />
                    <Button
                      variant="primary"
                      disabled={sessionCompleted || !searchQuery.trim() || searchRound.isPending}
                      onClick={() => searchRound.mutate()}
                    >
                      <Search size={14} />
                      搜索一轮
                    </Button>
                  </div>
                </Surface>

                <Surface title="研究轨迹">
                  <div className={styles.timeline}>
                    {state.data.rounds.map((round) => {
                      const assessment = state.data.assessments.find((item) => item.queryId === round.id)
                      return (
                        <article key={round.id} className={styles.timelineItem}>
                          <div className={styles.timelineRail}><span>{round.round}</span></div>
                          <div className={styles.timelineContent}>
                            <header>
                              <div>
                                <strong>{round.query}</strong>
                                <small>{formatDate(round.createdAt)} · {round.resultCount} 个来源</small>
                              </div>
                              <div className={styles.inlineActions}>
                                {assessment ? (
                                  <Badge tone={qualityTone(assessment.quality.verdict)}>
                                    {assessment.quality.verdict}
                                  </Badge>
                                ) : null}
                                <Button
                                  size="small"
                                  onClick={() => assess.mutate(round.id)}
                                  disabled={sessionCompleted || assess.isPending}
                                >
                                  <Scale size={13} />
                                  {assessment ? '重新评估' : '质量评估'}
                                </Button>
                              </div>
                            </header>
                            <div className={styles.engineLine}>
                              {round.succeededEngines.map((engine) => (
                                <Badge key={engine} tone="success">{engine}</Badge>
                              ))}
                              {round.failedEngines.map((failure, index) => (
                                <Badge key={`${round.id}:failure:${index}`} tone="danger">
                                  {String(failure.engine ?? '失败引擎')}
                                </Badge>
                              ))}
                            </div>
                            {assessment ? <AssessmentDetails assessment={assessment} /> : null}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </Surface>

                <Surface title="来源审核">
                  <div className={styles.sourceList}>
                    {state.data.results.map((result) => {
                      const snapshot = latestSnapshot(state.data, result.id)
                      return (
                        <article key={result.id} className={styles.sourceRow}>
                          <div className={styles.sourceMain}>
                            <div className={styles.sourceTitle}>
                              <a href={result.url} target="_blank" rel="noreferrer">
                                {result.title}
                                <ExternalLink size={13} />
                              </a>
                              <Badge tone={resultTone(result.status)}>{result.status}</Badge>
                              <Badge>RRF {result.rrfScore.toFixed(3)}</Badge>
                            </div>
                            <p>{result.snippet}</p>
                            <div className={styles.sourceMeta}>
                              <span>{result.engine || result.source}</span>
                              <span>{result.origins.length} 轮命中</span>
                              <span>
                                {snapshot?.status === 'ready'
                                  ? `快照 ${snapshot.charCount} 字符`
                                  : snapshot?.status === 'failed'
                                    ? `提取失败：${snapshot.error}`
                                    : '尚未提取正文'}
                              </span>
                            </div>
                          </div>
                          <div className={styles.sourceActions}>
                            <Button
                              size="small"
                              onClick={() => extract.mutate([result.id])}
                              disabled={sessionCompleted || extract.isPending}
                              aria-label={`提取 ${result.title}`}
                            >
                              <FileSearch size={13} />
                              提取
                            </Button>
                            <Button
                              size="small"
                              onClick={() => reviewResult.mutate({ resultId: result.id, status: 'approved' })}
                              disabled={sessionCompleted || reviewResult.isPending || result.status === 'approved'}
                              aria-label={`批准 ${result.title}`}
                            >
                              <Check size={13} />
                            </Button>
                            <Button
                              size="small"
                              variant="danger"
                              onClick={() => reviewResult.mutate({ resultId: result.id, status: 'rejected' })}
                              disabled={sessionCompleted || reviewResult.isPending || result.status === 'rejected'}
                              aria-label={`拒绝 ${result.title}`}
                            >
                              <X size={13} />
                            </Button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </Surface>

                <Surface title="Claim · Evidence · Review">
                  <div className={styles.claimComposer}>
                    <Textarea
                      value={claimText}
                      disabled={sessionCompleted}
                      onChange={(event) => setClaimText(event.target.value)}
                      placeholder="写成一个可以被证据支持或反驳的原子主张"
                    />
                    <Select
                      value={claimRisk}
                      disabled={sessionCompleted}
                      onChange={(event) => setClaimRisk(event.target.value as ClaimRisk)}
                      aria-label="主张风险等级"
                    >
                      <option value="low">低风险</option>
                      <option value="medium">中风险</option>
                      <option value="high">高风险</option>
                    </Select>
                    <Button
                      variant="primary"
                      onClick={() => createClaim.mutate()}
                      disabled={sessionCompleted || !claimText.trim() || createClaim.isPending}
                    >
                      <Plus size={14} />
                      添加主张
                    </Button>
                  </div>
                  <div className={styles.claimList}>
                    {state.data.claims.map((claim) => (
                      <ClaimRow
                        key={claim.id}
                        claim={claim}
                        state={state.data}
                        candidates={candidateMap[claim.id] ?? []}
                        candidatesPending={candidates.isPending && candidates.variables === claim.id}
                        onFindCandidates={() => candidates.mutate(claim.id)}
                        onAddEvidence={(candidate, stance) =>
                          addEvidence.mutate({ claimId: claim.id, candidate, stance })}
                        onReview={() => reviewClaim.mutate(claim.id)}
                        reviewPending={reviewClaim.isPending}
                        readOnly={sessionCompleted}
                      />
                    ))}
                  </div>
                </Surface>

                <Surface
                  title="写入 Wiki / PKM"
                  action={state.data.writebacks[0] ? (
                    <Badge tone="success">最近写入 {state.data.writebacks[0].wikiPath}</Badge>
                  ) : null}
                >
                  <div className={styles.writeback}>
                    <div>
                      <ShieldCheck size={20} />
                      <span>
                        <strong>仅固化通过审核的主张</strong>
                        <small>冲突、单一来源和证据不足的主张不会作为已验证知识写入。</small>
                      </span>
                    </div>
                    <Textarea
                      value={writebackSummary}
                      disabled={sessionCompleted}
                      onChange={(event) => setWritebackSummary(event.target.value)}
                      placeholder="填写本次研究结论摘要"
                    />
                    <Button
                      variant="primary"
                      onClick={() => writeback.mutate()}
                      disabled={
                        sessionCompleted
                        || !writebackSummary.trim()
                        || approvedClaims.size === 0
                        || writeback.isPending
                      }
                    >
                      <DatabaseZap size={14} />
                      写入并完成研究
                    </Button>
                  </div>
                </Surface>
              </>
            ) : null}
          </AsyncState>
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建研究会话"
        footer={(
          <Button
            variant="primary"
            onClick={() => createSession.mutate(sessionForm)}
            disabled={!sessionForm.title.trim() || createSession.isPending}
          >
            创建
          </Button>
        )}
      >
        <div className={styles.dialogFields}>
          <Field label="主题">
            <Input
              value={sessionForm.title}
              onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })}
            />
          </Field>
          <Field label="范围与证据要求">
            <Textarea
              value={sessionForm.description}
              onChange={(event) => setSessionForm({ ...sessionForm, description: event.target.value })}
            />
          </Field>
        </div>
      </Dialog>
    </>
  )
}

function AssessmentDetails({ assessment }: { assessment: ResearchAssessment }) {
  const labels: Record<string, string> = {
    contentDepth: '正文深度',
    sourceDiversity: '来源多样性',
    novelty: '新颖度',
  }
  return (
    <div className={styles.assessment}>
      <div className={styles.indicators}>
        {Object.entries(assessment.quality.breakdown).map(([key, indicator]) => (
          <span key={key}>
            <small>{labels[key] ?? key}</small>
            <strong>{indicatorValue(indicator)}</strong>
          </span>
        ))}
      </div>
      {assessment.suggestions.length ? (
        <div className={styles.suggestions}>
          {assessment.suggestions.map((suggestion) => (
            <div key={`${assessment.queryId}:${suggestion.query}`}>
              <Search size={13} />
              <span><strong>{suggestion.query}</strong><small>{suggestion.reason}</small></span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ClaimRow({
  claim,
  state,
  candidates,
  candidatesPending,
  reviewPending,
  readOnly,
  onFindCandidates,
  onAddEvidence,
  onReview,
}: {
  claim: ResearchClaim
  state: ResearchState
  candidates: EvidenceCandidate[]
  candidatesPending: boolean
  reviewPending: boolean
  readOnly: boolean
  onFindCandidates: () => void
  onAddEvidence: (candidate: EvidenceCandidate, stance: EvidenceStance) => void
  onReview: () => void
}) {
  const evidence = state.evidence.filter((item) => item.claimId === claim.id)
  const review = state.claimReviews.find((item) => item.claimId === claim.id)
  return (
    <article className={styles.claimRow}>
      <header>
        <div>
          <strong>{claim.text}</strong>
          <small>{claim.riskLevel} 风险 · {evidence.length} 条证据</small>
        </div>
        <Badge tone={reviewTone(review?.decision)}>{reviewLabel(review?.decision)}</Badge>
      </header>
      {evidence.length ? (
        <div className={styles.evidenceList}>
          {evidence.map((item) => (
            <blockquote key={item.id}>
              <Badge tone={item.stance === 'support' ? 'success' : item.stance === 'refute' ? 'danger' : 'warning'}>
                {item.stance}
              </Badge>
              <span>{item.quote}</span>
              <a href={item.resultUrl} target="_blank" rel="noreferrer">来源</a>
            </blockquote>
          ))}
        </div>
      ) : null}
      {review?.conflict ? (
        <div className={styles.conflict}>
          <Scale size={15} />
          <span>{String(review.conflict.summary ?? '证据存在冲突，需要人工复核。')}</span>
        </div>
      ) : null}
      <div className={styles.inlineActions}>
        <Button size="small" onClick={onFindCandidates} disabled={candidatesPending}>
          {candidatesPending ? <RefreshCw className={styles.spin} size={13} /> : <FileSearch size={13} />}
          查找证据
        </Button>
        <Button size="small" onClick={onReview} disabled={readOnly || !evidence.length || reviewPending}>
          <ShieldCheck size={13} />
          执行审核
        </Button>
      </div>
      {candidates.length ? (
        <div className={styles.candidateList}>
          {candidates.map((candidate) => (
            <div key={`${claim.id}:${candidate.resultId}:${candidate.contentHash}`}>
              <span>
                <strong>匹配度 {(candidate.similarity * 100).toFixed(0)}%</strong>
                <small>{candidate.quote}</small>
              </span>
              <div className={styles.inlineActions}>
                <Button size="small" disabled={readOnly} onClick={() => onAddEvidence(candidate, 'support')}>支持</Button>
                <Button size="small" variant="danger" disabled={readOnly} onClick={() => onAddEvidence(candidate, 'refute')}>反驳</Button>
                <Button size="small" disabled={readOnly} onClick={() => onAddEvidence(candidate, 'insufficient')}>不足</Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

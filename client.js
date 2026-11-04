window.__ModuleLoader__.load({
  id: 'dsh-codex-advisor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-codex-advisor';
    const SNAPSHOT_ENDPOINT = 'plugins/dsh-codex-advisor/snapshot';
    const HISTORY_ENDPOINT = 'plugins/dsh-codex-advisor/history';
    const UPDATE_ENDPOINT = 'plugins/dsh-codex-advisor/update';

    let fallbackT = (key) => key;
    let activeSessionId = null;
    const activeSessionListeners = new Set();

    function setActiveSession(id) {
      if (activeSessionId === id) return;
      activeSessionId = id;
      for (const listener of activeSessionListeners) listener();
    }

    function clearActiveSession(id) {
      if (activeSessionId !== id) return;
      activeSessionId = null;
      for (const listener of activeSessionListeners) listener();
    }

    function subscribeActiveSession(listener) {
      activeSessionListeners.add(listener);
      return () => activeSessionListeners.delete(listener);
    }

    function getActiveSession() {
      return activeSessionId;
    }

    function useActiveSession() {
      const [value, setValue] = React.useState(getActiveSession());
      React.useEffect(() => {
        setValue(getActiveSession());
        return subscribeActiveSession(() => setValue(getActiveSession()));
      }, []);
      return value;
    }

    function SessionProbe(props) {
      const id = typeof props.sessionId === 'string' ? props.sessionId : null;
      React.useLayoutEffect(() => {
        setActiveSession(id);
        return () => clearActiveSession(id);
      }, [id]);
      return null;
    }

    const zh = {
      tab: 'Codex',
      cardTitle: 'Codex 顾问',
      tabTitle: 'Codex 轨迹',
      subtitle: '外部 Codex 的回答与活动，按会话时间线排列',
      external: '外部 Codex',
      noSession: '未打开会话',
      emptyTitle: '还没有 Codex 轮次',
      emptyHint: '在对话里用 codex_ask 问一次，这里会按时间线显示回答、命令和文件。',
      loading: '读取中…',
      error: '读取失败',
      refresh: '刷新',
      statusReady: '可继续',
      statusBound: '等待首次回答',
      statusFailed: '上次失败',
      statusEmpty: '尚未使用',
      statusCompleted: '已完成',
      statusFailedTurn: '失败',
      statusInterrupted: '已中断',
      statusCancelled: '已取消',
      statusRunning: '进行中',
      ask: '你问',
      answer: 'Codex',
      failedReason: '失败原因',
      noAnswer: '没有文本回答',
      activity: '活动',
      commands: '命令',
      files: '文件',
      rounds: '轮',
      lastActivity: '上次活动',
      lastAnswer: '上次回答',
      justNow: '刚刚',
      minutesAgo: '分钟前',
      hoursAgo: '小时前',
      daysAgo: '天前',
      source: '来源',
      version: '版本',
      updateAvailable: '有新版本',
      cardEmpty: '在对话里问一次 Codex',
      cardFailed: '上次轮次没有完成',
      cardWaiting: '还没有回答',
    };

    const en = {
      tab: 'Codex',
      cardTitle: 'Codex advisor',
      tabTitle: 'Codex trail',
      subtitle: 'External Codex answers and activity, ordered by session timeline',
      external: 'external Codex',
      noSession: 'No conversation open',
      emptyTitle: 'No Codex turn yet',
      emptyHint: 'Ask once with codex_ask in the conversation; answers, commands and files will appear here as a timeline.',
      loading: 'Loading…',
      error: 'Read failed',
      refresh: 'Refresh',
      statusReady: 'Ready',
      statusBound: 'Waiting for first answer',
      statusFailed: 'Last turn failed',
      statusEmpty: 'Not used yet',
      statusCompleted: 'completed',
      statusFailedTurn: 'failed',
      statusInterrupted: 'interrupted',
      statusCancelled: 'cancelled',
      statusRunning: 'running',
      ask: 'You asked',
      answer: 'Codex',
      failedReason: 'Failure',
      noAnswer: 'No text answer',
      activity: 'Activity',
      commands: 'Commands',
      files: 'Files',
      rounds: 'turns',
      lastActivity: 'Last activity',
      lastAnswer: 'Last answer',
      justNow: 'just now',
      minutesAgo: 'min ago',
      hoursAgo: 'h ago',
      daysAgo: 'd ago',
      source: 'source',
      version: 'version',
      updateAvailable: 'Update available',
      cardEmpty: 'Ask Codex in the conversation',
      cardFailed: 'The last turn did not complete',
      cardWaiting: 'No answer yet',
    };

    async function getJson(path, params) {
      const url = new URL(path, document.baseURI);
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
      const response = await fetch(url.pathname + url.search, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    function useT(props) {
      return typeof props?.t === 'function' ? props.t : fallbackT;
    }

    function toDate(value) {
      if (value === undefined || value === null || value === '') return null;
      if (typeof value === 'number') {
        const date = new Date(value < 1e12 ? value * 1000 : value);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatWhen(value, t) {
      const date = toDate(value);
      if (!date) return '';
      const diff = Date.now() - date.getTime();
      if (diff >= 0 && diff < 60 * 1000) return t('justNow');
      if (diff >= 60 * 1000 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} ${t('minutesAgo')}`;
      if (diff >= 60 * 60 * 1000 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} ${t('hoursAgo')}`;
      if (diff >= 24 * 60 * 60 * 1000 && diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} ${t('daysAgo')}`;
      return date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function statusMeta(status, t) {
      if (status === 'completed') return { label: t('statusCompleted'), color: '#16a34a' };
      if (status === 'failed') return { label: t('statusFailedTurn'), color: '#dc2626' };
      if (status === 'interrupted' || status === 'cancelled') return { label: t('statusInterrupted'), color: '#d97706' };
      if (status === 'inProgress' || status === 'in_progress' || status === 'running') return { label: t('statusRunning'), color: '#2563eb' };
      return { label: String(status ?? ''), color: 'var(--dsw-alias-label-secondary)' };
    }

    function VersionBadge(props) {
      const t = props.t;
      const version = typeof props.version === 'string' && props.version ? props.version.replace(/^v/i, '') : null;
      const update = props.update;
      return h('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 10.5,
          whiteSpace: 'nowrap',
        },
      },
      version ? h('span', null, `v${version}`) : null,
      update?.updateAvailable
        ? h('span', {
          title: `${t('updateAvailable')}${update.latestVersion ? `: v${update.latestVersion}` : ''}`,
          style: { width: 6, height: 6, borderRadius: 99, background: '#ef4444', display: 'inline-block' },
        })
        : null);
    }

    let updateCache = null;
    let updateCacheAt = 0;
    let updateInFlight = null;

    async function loadUpdate(force = false) {
      if (!force && updateCache && Date.now() - updateCacheAt < 6 * 60 * 60 * 1000) return updateCache;
      if (updateInFlight) return updateInFlight;
      updateInFlight = getJson(UPDATE_ENDPOINT)
        .then((value) => {
          updateCache = value;
          updateCacheAt = Date.now();
          return value;
        })
        .catch(() => updateCache)
        .finally(() => { updateInFlight = null; });
      return updateInFlight;
    }

    function useUpdate() {
      const [value, setValue] = React.useState(updateCache);
      React.useEffect(() => {
        let alive = true;
        const load = async () => {
          const next = await loadUpdate();
          if (alive) setValue(next);
        };
        load();
        const timer = setInterval(load, 6 * 60 * 60 * 1000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      return value;
    }

    function CodexCard(props) {
      const t = useT(props);
      const sessionId = useActiveSession();
      const update = useUpdate();
      const [snapshot, setSnapshot] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);

      const load = React.useCallback(async () => {
        if (!sessionId) {
          setSnapshot(null);
          setError(null);
          return;
        }
        setLoading(true);
        try {
          const value = await getJson(SNAPSHOT_ENDPOINT, { session_id: sessionId });
          setSnapshot(value);
          setError(null);
        } catch (err) {
          setError(err?.message ?? String(err));
        } finally {
          setLoading(false);
        }
      }, [sessionId]);

      React.useEffect(() => {
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
      }, [load]);

      const failure = snapshot?.last_failure ?? null;
      const answer = typeof snapshot?.last_answer === 'string' ? snapshot.last_answer.trim() : '';
      const failureAt = toDate(failure?.at)?.getTime() ?? 0;
      const answerAt = toDate(snapshot?.last_answer_at)?.getTime() ?? 0;
      const failed = Boolean(failure && failureAt >= answerAt);
      const hasAnswer = !failed && Boolean(answer);
      const status = !sessionId
        ? 'empty'
        : failed
          ? 'failed'
          : hasAnswer
            ? 'ready'
            : snapshot?.thread_id
              ? 'bound'
              : 'empty';
      const statusLabel = status === 'failed'
        ? t('statusFailed')
        : status === 'ready'
          ? t('statusReady')
          : status === 'bound'
            ? t('statusBound')
            : t('statusEmpty');
      const statusColor = status === 'failed'
        ? '#dc2626'
        : status === 'ready'
          ? '#16a34a'
          : status === 'bound'
            ? '#d97706'
            : 'var(--dsw-alias-label-secondary)';
      const meta = [snapshot?.model, snapshot?.effort].filter(Boolean).join(' · ');
      const body = !sessionId
        ? t('noSession')
        : failed
          ? (failure?.message || t('cardFailed'))
          : hasAnswer
            ? answer
            : t('cardEmpty');
      const when = failed
        ? formatWhen(failure?.at, t)
        : hasAnswer
          ? formatWhen(snapshot?.last_answer_at, t)
          : snapshot?.thread_id
            ? formatWhen(snapshot?.last_ask_at, t)
            : '';
      const version = update?.currentVersion ?? snapshot?.source?.version ?? null;

      return h('div', {
        style: {
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          flex: '0 0 100%',
          order: 1,
          gridColumn: '1 / -1',
          margin: '0 0 6px',
          padding: '10px 11px 9px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        },
        role: 'group',
        'aria-label': t('cardTitle'),
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
        h('span', { style: { fontWeight: 650, fontSize: 13, whiteSpace: 'nowrap' } }, t('cardTitle')),
        h('span', { style: { marginLeft: 'auto' } }, h(VersionBadge, { t, update, version })),
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
        h('span', { style: { width: 7, height: 7, borderRadius: 99, background: statusColor, flex: '0 0 auto' } }),
        h('span', { style: { fontSize: 11.5, whiteSpace: 'nowrap' } }, statusLabel),
        meta ? h('span', {
          style: {
            marginLeft: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 10.5,
          },
        }, meta) : null,
      ),
      h('div', {
        style: {
          margin: 0,
          color: status === 'failed' ? '#b91c1c' : (hasAnswer ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'),
          fontSize: 12,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        },
      }, body),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, minWidth: 0 } },
        when ? h('span', null, `${t('lastActivity')} ${when}`) : null,
        error ? h('span', { title: error, style: { marginLeft: 'auto', color: '#b91c1c' } }, t('error')) : null,
        loading && !snapshot ? h('span', { style: { marginLeft: 'auto' } }, t('loading')) : null,
      ));
    }

    function TurnCard(props) {
      const { turn, t } = props;
      const meta = statusMeta(turn.status, t);
      const when = formatWhen(turn.created_at, t);
      const commands = Array.isArray(turn.commands) ? turn.commands : [];
      const files = Array.isArray(turn.files) ? turn.files : [];
      return h('div', { style: { position: 'relative', marginBottom: 16 } },
        h('span', {
          style: {
            position: 'absolute',
            left: -20,
            top: 6,
            width: 10,
            height: 10,
            borderRadius: 99,
            background: meta.color,
            border: '2px solid var(--dsw-alias-bg-layer-1)',
            boxSizing: 'border-box',
          },
        }),
        h('div', {
          style: {
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '13px 15px',
            background: 'var(--dsw-alias-bg-layer-1)',
            minWidth: 0,
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('span', { style: { color: meta.color, fontSize: 11.5, fontWeight: 600 } }, meta.label),
          when ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5 } }, when) : null,
        ),
        turn.ask ? h('div', { style: { marginBottom: 10 } },
          h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 3 } }, t('ask')),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, fontSize: 13 } }, turn.ask),
        ) : null,
        turn.answer ? h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 } },
          h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 3 } }, t('answer')),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.65, fontSize: 13 } }, turn.answer),
        ) : h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 } },
          h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 3 } }, t('answer')),
          turn.error
            ? h('div', { style: { color: '#b91c1c', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, turn.error)
            : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('noAnswer')),
        ),
        turn.error && turn.answer ? h('div', { style: { marginTop: 8, color: '#b91c1c', fontSize: 11.5, lineHeight: 1.5 } }, `${t('failedReason')}: ${turn.error}`) : null,
        (commands.length > 0 || files.length > 0) ? h('div', { style: { marginTop: 11, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 9 } },
          h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 5 } }, t('activity')),
          commands.length > 0 ? h('div', { style: { marginBottom: files.length > 0 ? 7 : 0 } },
            h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 3 } }, t('commands')),
            commands.map((command, index) => h('code', {
              key: index,
              style: {
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                color: 'var(--dsw-alias-label-secondary)',
                lineHeight: 1.7,
              },
            }, `${command.command ?? ''}${command.status ? `  [${command.status}]` : ''}`)),
          ) : null,
          files.length > 0 ? h('div', null,
            h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, marginBottom: 3 } }, t('files')),
            h('div', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.7 } }, files.join('\n')),
          ) : null,
        ) : null,
        ),
      );
    }

    function CodexView(props) {
      const t = useT(props);
      const active = useActiveSession();
      const sessionId = typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : active;
      const update = useUpdate();
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);

      const load = React.useCallback(async () => {
        if (!sessionId) {
          setData(null);
          setError(null);
          return;
        }
        setLoading(true);
        try {
          const value = await getJson(HISTORY_ENDPOINT, { session_id: sessionId, limit: 20 });
          setData(value);
          setError(null);
        } catch (err) {
          setError(err?.message ?? String(err));
        } finally {
          setLoading(false);
        }
      }, [sessionId]);

      React.useEffect(() => { load(); }, [load]);

      const turns = Array.isArray(data?.turns) ? data.turns : [];
      const model = data?.model ?? data?.source?.model ?? null;
      const effort = data?.effort ?? data?.source?.effort ?? null;
      const version = update?.currentVersion ?? data?.source?.version ?? null;
      const lastAt = turns.length > 0 ? turns[turns.length - 1].created_at : null;
      const meta = [model, effort].filter(Boolean).join(' · ');

      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 9,
        padding: '5px 11px',
        fontSize: 12,
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.6 : 1,
      };

      return h('div', {
        style: {
          height: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: '28px 32px 120px',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('div', { style: { maxWidth: 860, margin: '0 auto' } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' } },
              h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.01em' } }, t('tabTitle')),
              h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '1px 7px' } }, t('external')),
              h(VersionBadge, { t, update, version }),
            ),
            h('div', { style: { marginTop: 5, color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5 } }, t('subtitle')),
            h('div', { style: { marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
              meta ? h('span', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '2px 8px' } }, meta) : null,
              h('span', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '2px 8px' } }, `${turns.length} ${t('rounds')}`),
              lastAt ? h('span', { style: { padding: '2px 8px' } }, `${t('lastActivity')} ${formatWhen(lastAt, t)}`) : null,
            ),
          ),
          h('button', { type: 'button', style: { marginLeft: 'auto', ...buttonStyle }, onClick: load, disabled: loading }, t('refresh')),
        ),
        error ? h('div', { style: { border: '1px solid #fecaca', borderRadius: 12, background: 'rgba(254, 226, 226, 0.35)', color: '#b91c1c', padding: '12px 14px', fontSize: 12.5, lineHeight: 1.55 } }, `${t('error')}: ${error}`) : null,
        !error && !sessionId ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: '14px 16px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5 } }, t('noSession')) : null,
        !error && sessionId && loading && !data ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 } },
          [0, 1, 2].map((index) => h('div', {
            key: index,
            style: { height: 12, width: index === 0 ? '42%' : (index === 1 ? '78%' : '62%'), borderRadius: 99, background: 'var(--dsw-alias-border-l1)', opacity: 0.55 },
          })),
        ) : null,
        !error && sessionId && !loading && turns.length === 0 ? h('div', { style: { maxWidth: 520, margin: '56px auto 0', textAlign: 'center' } },
          h('div', { style: { width: 34, height: 34, margin: '0 auto 14px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            h('span', { style: { width: 6, height: 6, borderRadius: 99, background: '#16a34a' } })),
          h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, t('emptyTitle')),
          h('div', { style: { fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } }, t('emptyHint')),
        ) : null,
        turns.length > 0 ? h('div', { style: { position: 'relative', paddingLeft: 24 } },
          h('div', { style: { position: 'absolute', left: 4, top: 8, bottom: 8, width: 1, background: 'var(--dsw-alias-border-l1)' } }),
          turns.map((turn) => h(TurnCard, { key: turn.turn_id ?? `${turn.status}-${turn.ask}`, turn, t })),
        ) : null,
        h('div', { style: { marginTop: 24, color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5 } },
          `${t('source')} · dsh-codex-advisor${version ? ` ${version}` : ''} · ${t('external')}`),
      ));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        fallbackT = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-codex-advisor: locale dictionaries');
        const t = ctx.locale.bind(NS);
        fallbackT = t;

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'codex-advisor-session-probe',
          order: -1000,
        }, SessionProbe));

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'codex-advisor-card',
          order: 20,
          locale: NS,
          inject: () => ({ t }),
        }, CodexCard));

        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'codex-advisor',
          order: 20,
          label: t('tab'),
        }, CodexView));
      },
    };
  },
});

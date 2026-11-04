window.__ModuleLoader__.load({
  id: 'dsh-codex-advisor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-codex-advisor';
    const SNAPSHOT_ENDPOINT = 'plugins/dsh-codex-advisor/snapshot';
    const HISTORY_ENDPOINT = 'plugins/dsh-codex-advisor/history';

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
      tabTitle: 'Codex 顾问轨迹',
      subtitle: '外部 Codex 线程；请求、回答、命令与文件都可追溯',
      cardTitle: 'Codex 顾问',
      cardSubtitle: '外部 Codex',
      noSession: '未打开会话',
      empty: '本会话还没有 Codex 轮次',
      bound: '线程已绑定，等待回答',
      waiting: '等待 Codex 回答',
      loading: '读取中…',
      error: '读取失败',
      refresh: '刷新',
      thread: '线程',
      model: '模型',
      effort: 'effort',
      turns: '轮次',
      asks: '请求',
      ask: '请求',
      answer: '回答',
      commands: '命令',
      files: '文件',
      source: '来源',
      external: '外部 Codex',
      noTurns: '本会话还没有 Codex 轮次。用 codex_ask 发起一次顾问调用后，这里会显示 Codex 侧的请求、回答、命令与文件。',
      updated: '更新于',
      cardHint: '完整轨迹在 Codex 标签页',
    };

    const en = {
      tab: 'Codex',
      tabTitle: 'Codex advisor trail',
      subtitle: 'External Codex thread; requests, answers, commands and files are traceable',
      cardTitle: 'Codex advisor',
      cardSubtitle: 'external Codex',
      noSession: 'No conversation open',
      empty: 'No Codex turn in this session yet',
      bound: 'Thread bound; waiting for an answer',
      waiting: 'Waiting for Codex',
      loading: 'Loading…',
      error: 'Read failed',
      refresh: 'Refresh',
      thread: 'thread',
      model: 'model',
      effort: 'effort',
      turns: 'turns',
      asks: 'asks',
      ask: 'ask',
      answer: 'answer',
      commands: 'commands',
      files: 'files',
      source: 'source',
      external: 'external Codex',
      noTurns: 'No Codex turn in this session yet. Call codex_ask once and the Codex-side request, answer, commands and files will appear here.',
      updated: 'updated',
      cardHint: 'Full trail is in the Codex tab',
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

    function shortThread(id) {
      return typeof id === 'string' && id.length > 10 ? `${id.slice(0, 8)}…` : (id || '—');
    }

    function shortTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function statusColor(status) {
      if (status === 'ready') return '#22c55e';
      if (status === 'bound' || status === 'waiting') return '#f59e0b';
      return 'var(--dsw-alias-label-secondary)';
    }

    function CodexCard(props) {
      const t = useT(props);
      const sessionId = useActiveSession();
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

      const status = !sessionId ? 'empty' : (snapshot?.status ?? (loading ? 'waiting' : 'empty'));
      const model = snapshot?.model ?? snapshot?.source?.model ?? null;
      const effort = snapshot?.effort ?? snapshot?.source?.effort ?? null;
      const label = [model, effort].filter(Boolean).join(' · ') || t('external');
      const answer = typeof snapshot?.last_answer === 'string' ? snapshot.last_answer.trim() : '';
      const detail = !sessionId
        ? t('noSession')
        : error
          ? `${t('error')}: ${error}`
          : loading && !snapshot
            ? t('loading')
            : answer
              ? answer
              : snapshot?.status === 'bound'
                ? t('bound')
                : t('empty');

      const rootStyle = {
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        flex: '0 0 100%',
        order: 1,
        gridColumn: '1 / -1',
        margin: '0 0 6px',
        padding: '10px 10px 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      };
      const answerStyle = {
        margin: 0,
        color: answer ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: 1.45,
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 3,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      };

      return h('div', {
        style: rootStyle,
        role: 'group',
        'aria-label': t('cardTitle'),
        title: t('cardHint'),
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { width: 7, height: 7, borderRadius: 99, background: statusColor(status), flex: '0 0 auto' } }),
        h('span', { style: { fontWeight: 650, fontSize: 13 } }, t('cardTitle')),
        h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)', fontSize: 11, fontVariantNumeric: 'tabular-nums' } }, label)
      ),
      h('div', { style: answerStyle }, detail),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5 } },
        h('span', null, `${t('thread')} ${shortThread(snapshot?.thread_id)}`),
        snapshot?.asks ? h('span', null, `${t('asks')} ${snapshot.asks}`) : null,
        snapshot?.last_answer_at ? h('span', { style: { marginLeft: 'auto' } }, shortTime(snapshot.last_answer_at)) : null
      ));
    }

    function StatusPill(props) {
      const status = props.status || 'unknown';
      const color = status === 'completed'
        ? '#16a34a'
        : status === 'interrupted'
          ? '#d97706'
          : status === 'failed'
            ? '#dc2626'
            : 'var(--dsw-alias-label-secondary)';
      return h('span', {
        style: {
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 999,
          padding: '1px 7px',
          fontSize: 10.5,
          color,
          whiteSpace: 'nowrap',
        },
      }, status);
    }

    function CodexView(props) {
      const t = useT(props);
      const active = useActiveSession();
      const sessionId = typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : active;
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
      const source = data?.source ?? {};

      const rootStyle = {
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: '22px 28px 48px',
        color: 'var(--dsw-alias-label-primary)',
      };
      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 8,
        padding: '5px 10px',
        fontSize: 12,
        cursor: 'pointer',
      };
      const cardStyle = {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        padding: '12px 14px',
        margin: '0 0 12px',
        background: 'var(--dsw-alias-bg-layer-1)',
        minWidth: 0,
      };
      const labelStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, marginBottom: 3 };
      const textStyle = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, fontSize: 13 };
      const monoStyle = { ...textStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' };

      return h('div', { style: rootStyle },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 650 } }, t('tabTitle')),
              h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '1px 7px' } }, t('external')),
            ),
            h('div', { style: { marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('subtitle')),
            h('div', { style: { marginTop: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, display: 'flex', gap: 12, flexWrap: 'wrap' } },
              h('span', null, `${t('source')}: ${source.plugin ?? 'dsh-codex-advisor'} ${source.version ?? ''}`.trim()),
              h('span', null, `${t('model')}: ${model ?? 'default'}`),
              h('span', null, `${t('effort')}: ${effort ?? 'default'}`),
              h('span', null, `${t('thread')}: ${shortThread(data?.thread_id)}`),
              h('span', null, `${t('turns')}: ${data?.returned ?? 0}/${data?.total_turns ?? data?.returned ?? 0}`),
            ),
          ),
          h('button', { type: 'button', style: { marginLeft: 'auto', ...buttonStyle }, onClick: load, disabled: loading }, t('refresh')),
        ),
        error ? h('div', { style: { ...cardStyle, borderColor: '#fecaca', color: '#b91c1c' } }, `${t('error')}: ${error}`) : null,
        !error && !sessionId ? h('div', { style: { ...cardStyle, color: 'var(--dsw-alias-label-secondary)' } }, t('noSession')) : null,
        !error && sessionId && loading && !data ? h('div', { style: { ...cardStyle, color: 'var(--dsw-alias-label-secondary)' } }, t('loading')) : null,
        !error && sessionId && !loading && turns.length === 0 ? h('div', { style: { ...cardStyle, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, t('noTurns')) : null,
        turns.map((turn) => h('section', { key: turn.turn_id ?? `${turn.status}-${turn.ask}`, style: cardStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, minWidth: 0 } },
            h('code', { style: { ...monoStyle, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, turn.turn_id ?? '—'),
            h('span', { style: { marginLeft: 'auto' } }, h(StatusPill, { status: turn.status })),
            turn.created_at ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5 } }, shortTime(turn.created_at)) : null,
          ),
          turn.ask ? h('div', { style: { marginBottom: 8 } },
            h('div', { style: labelStyle }, t('ask')),
            h('div', { style: textStyle }, turn.ask),
          ) : null,
          turn.answer ? h('div', { style: { marginBottom: 8 } },
            h('div', { style: labelStyle }, t('answer')),
            h('div', { style: textStyle }, turn.answer),
          ) : null,
          turn.commands?.length ? h('div', { style: { marginBottom: 6 } },
            h('div', { style: labelStyle }, t('commands')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              turn.commands.map((command, index) => h('code', { key: index, style: { ...monoStyle, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '4px 6px' } },
                `${command.command ?? ''}${command.status ? `  [${command.status}]` : ''}`,
              )),
            ),
          ) : null,
          turn.files?.length ? h('div', null,
            h('div', { style: labelStyle }, t('files')),
            h('div', { style: monoStyle }, turn.files.join('\n')),
          ) : null,
        )),
      );
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

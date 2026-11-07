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
      statusPending: '上次请求未完成',
      statusFailed: '上次失败',
      statusEmpty: '尚未使用',
      statusNoSession: '未打开会话',
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
      cardNoSession: '打开一个会话后可用',
      cardFailed: '上次轮次没有完成',
      cardPending: '这次请求没有拿到回答，可在 Codex 轨迹里查看状态',
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
      statusPending: 'Last request unfinished',
      statusFailed: 'Last turn failed',
      statusEmpty: 'Not used yet',
      statusNoSession: 'No conversation open',
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
      checking: 'Checking…',
      upToDate: 'Up to date',
      updateFailed: 'Update check failed',
      checkForUpdates: 'Check for updates',
      cardNoThread: 'No Codex thread yet',
      cardEmpty: 'Ask Codex in the conversation',
      cardNoSession: 'Open a conversation to use it',
      cardFailed: 'The last turn did not complete',
      cardPending: 'The last request has no answer yet; open the Codex trail for the status',
      cardWaiting: 'No answer yet',
    };

    async function getJson(path, params, options = {}) {
      const timeoutMs = options.timeoutMs ?? 15000;
      const url = new URL(path, document.baseURI);
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url.pathname + url.search, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
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

    const THEME = {
      accent: 'var(--dsw-alias-link, #3b82f6)',
      askSurface: 'var(--dsw-alias-state-business-tertiary, #e4edfd)',
      success: 'var(--dsw-alias-state-success-primary, #16a34a)',
      error: 'var(--dsw-alias-state-error-primary, #dc2626)',
      warn: 'var(--dsw-alias-state-warn-primary, #d97706)',
      surface: 'var(--dsw-alias-bg-layer-1)',
    };

    function mixColor(color, weight, base = 'transparent') {
      return `color-mix(in srgb, ${color} ${weight}%, ${base})`;
    }

    function statusMeta(status, t) {
      if (status === 'completed') return { label: t('statusCompleted'), color: THEME.success };
      if (status === 'failed') return { label: t('statusFailedTurn'), color: THEME.error };
      if (status === 'interrupted' || status === 'cancelled') return { label: t('statusInterrupted'), color: THEME.warn };
      if (status === 'inProgress' || status === 'in_progress' || status === 'running') return { label: t('statusRunning'), color: THEME.accent };
      return { label: String(status ?? ''), color: 'var(--dsw-alias-label-secondary)' };
    }

    function VersionBadge(props) {
      const t = props.t;
      const version = typeof props.version === 'string' && props.version ? props.version.replace(/^v/i, '') : null;
      const update = props.update;
      const checking = Boolean(props.checking);
      const notice = props.notice ?? null;
      const title = update?.updateAvailable
        ? `${t('updateAvailable')}${update.latestVersion ? ` v${update.latestVersion}` : ''}`
        : checking
          ? t('checking')
          : (notice || t('checkForUpdates'));
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0 } },
        h('button', {
          type: 'button',
          title,
          'aria-label': `${t('checkForUpdates')}: ${title}`,
          disabled: checking,
          onClick: () => { void props.onCheck?.(); },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: 0,
            border: 0,
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 8.5,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            cursor: checking ? 'default' : 'pointer',
            opacity: checking ? 0.6 : 1,
          },
        },
        version ? `v${version}` : null,
        update?.updateAvailable
          ? h('span', {
            style: {
              width: 5,
              height: 5,
              borderRadius: 99,
              background: 'var(--dsw-alias-state-error-primary, #dc2626)',
              display: 'inline-block',
            },
            'aria-hidden': true,
          })
          : null),
        notice ? h('span', {
          style: {
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 7.5,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          },
        }, notice) : null,
      );
    }

    let updateCache = null;
    let updateCacheAt = 0;
    let updateInFlight = null;
    let updateBooted = false;
    let updateNoticeTimer = null;
    let updateShared = { value: updateCache, checking: false, notice: null };
    const updateListeners = new Set();

    function publishUpdate(patch) {
      updateShared = { ...updateShared, ...patch };
      for (const listener of updateListeners) listener();
    }

    function showUpdateNotice(text) {
      if (updateNoticeTimer) clearTimeout(updateNoticeTimer);
      publishUpdate({ notice: text });
      updateNoticeTimer = setTimeout(() => {
        publishUpdate({ notice: null });
      }, 6000);
    }

    async function loadUpdate(force = false) {
      if (!force && updateCache && Date.now() - updateCacheAt < 6 * 60 * 60 * 1000) return updateCache;
      if (updateInFlight) return updateInFlight;
      updateInFlight = getJson(UPDATE_ENDPOINT, force ? { refresh: '1' } : {})
        .then((value) => {
          if (value && !value.error) {
            updateCache = value;
            updateCacheAt = Date.now();
          }
          return value;
        })
        .catch(() => updateCache)
        .finally(() => { updateInFlight = null; });
      return updateInFlight;
    }

    function useUpdate() {
      const [state, setState] = React.useState(updateShared);
      React.useEffect(() => {
        const listener = () => setState(updateShared);
        updateListeners.add(listener);
        listener();
        return () => updateListeners.delete(listener);
      }, []);
      const check = React.useCallback(async (manual = true) => {
        if (manual) showUpdateNotice(fallbackT('checking'));
        publishUpdate({ checking: true });
        try {
          const next = await loadUpdate(manual);
          if (!next || next.error) {
            if (manual) showUpdateNotice(fallbackT('updateFailed'));
            publishUpdate({ checking: false });
            return null;
          }
          publishUpdate({ value: next, checking: false });
          if (manual) {
            showUpdateNotice(next.updateAvailable
              ? `${fallbackT('updateAvailable')}${next.latestVersion ? ` v${next.latestVersion}` : ''}`
              : fallbackT('upToDate'));
          }
          return next;
        } catch {
          if (manual) showUpdateNotice(fallbackT('updateFailed'));
          publishUpdate({ checking: false });
          return null;
        }
      }, []);
      React.useEffect(() => {
        if (updateBooted) return undefined;
        updateBooted = true;
        let alive = true;
        const boot = setTimeout(async () => {
          const next = await loadUpdate(false);
          if (alive && next) publishUpdate({ value: next });
        }, 1200);
        const daily = setInterval(async () => {
          const next = await loadUpdate(false);
          if (alive && next) publishUpdate({ value: next });
        }, 24 * 60 * 60 * 1000);
        return () => {
          alive = false;
          clearTimeout(boot);
          clearInterval(daily);
          if (updateNoticeTimer) {
            clearTimeout(updateNoticeTimer);
            updateNoticeTimer = null;
          }
        };
      }, []);
      return { ...state, check };
    }

    async function applyUpdate(spec) {
      const url = new URL('plugins/dsh-codex-advisor/update/apply', document.baseURI);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetch(url.pathname, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ spec }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok === false) {
          throw new Error(body.message || body.error || `HTTP ${response.status}`);
        }
        return body;
      } finally {
        clearTimeout(timer);
      }
    }

    function UpdateModal(props) {
      const { update, onClose } = props;
      const [applying, setApplying] = useStateSafe(false);
      const [result, setResult] = useStateSafe(null);
      const [error, setError] = useStateSafe(null);
      const [copied, setCopied] = useStateSafe(false);
      const latest = update?.latestVersion ?? null;
      const current = update?.currentVersion ?? null;
      const canApply = update?.canApply === true && Boolean(update?.spec);
      const notes = typeof update?.releaseNotes === 'string' ? update.releaseNotes.trim() : '';
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !applying) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [applying, onClose]);
      const copySpec = async () => {
        if (!update?.spec) return;
        try {
          await navigator.clipboard.writeText(update.spec);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch { /* clipboard may be unavailable */ }
      };
      const install = async () => {
        if (!canApply || applying) return;
        setApplying(true);
        setError(null);
        try {
          const value = await applyUpdate(update.spec);
          setResult(value);
        } catch (err) {
          setError(err?.message ?? String(err));
        } finally {
          setApplying(false);
        }
      };
      const secondary = {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        cursor: 'pointer',
      };
      const primary = {
        ...secondary,
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-bg-layer-1)',
        borderColor: 'var(--dsw-alias-label-primary)',
        fontWeight: 600,
        cursor: applying ? 'default' : 'pointer',
        opacity: applying ? 0.6 : 1,
      };
      return h('div', {
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0, 0, 0, 0.28)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        },
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !applying) onClose();
        },
      },
      h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Codex advisor update',
        style: {
          width: 'min(520px, 100%)',
          maxHeight: 'min(720px, 90vh)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 14,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          padding: '18px 20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
        h('div', { style: { fontSize: 16, fontWeight: 650 } }, 'Update available'),
        h('button', {
          type: 'button',
          onClick: onClose,
          disabled: applying,
          'aria-label': 'Close',
          style: {
            marginLeft: 'auto',
            border: 0,
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 18,
            lineHeight: 1,
            cursor: applying ? 'default' : 'pointer',
          },
        }, '×'),
      ),
      h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, marginBottom: 14 } },
        `v${current ?? '?'} → v${latest ?? '?'}${update?.releaseName ? ` · ${update.releaseName}` : ''}`),
      notes ? h('pre', {
        style: {
          margin: '0 0 14px',
          padding: '10px 12px',
          maxHeight: 220,
          overflow: 'auto',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
        },
      }, notes) : null,
      result ? h('div', {
        style: {
          marginBottom: 14,
          padding: '9px 11px',
          borderRadius: 8,
          border: `1px solid ${mixColor(THEME.success, 32, 'var(--dsw-alias-border-l1)')}`,
          background: mixColor(THEME.success, 12, 'var(--dsw-alias-bg-layer-1)'),
          color: 'var(--dsw-alias-state-success-primary)',
          fontSize: 12,
          lineHeight: 1.55,
        },
      }, 'Update installed. Quit and reopen DSH to load the new Codex advisor client.') : null,
      error ? h('div', {
        style: {
          marginBottom: 14,
          padding: '9px 11px',
          borderRadius: 8,
          border: `1px solid ${mixColor(THEME.error, 32, 'var(--dsw-alias-border-l1)')}`,
          background: mixColor(THEME.error, 10, 'var(--dsw-alias-bg-layer-1)'),
          color: 'var(--dsw-alias-state-error-primary)',
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        },
      }, error) : null,
      !canApply && !result ? h('div', {
        style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, lineHeight: 1.55, marginBottom: 12 },
      }, 'Automatic install is unavailable in this host. Open the release or copy the archive spec and install it with the plugin manager.') : null,
      update?.provider?.label ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10, marginBottom: 14 } },
        `Update provider: ${update.provider.label}`) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        update?.releaseUrl ? h('a', {
          href: update.releaseUrl,
          target: '_blank',
          rel: 'noreferrer',
          style: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 2 },
        }, 'Open release') : null,
        update?.spec ? h('button', { type: 'button', style: secondary, onClick: copySpec }, copied ? 'Copied' : 'Copy spec') : null,
        h('span', { style: { marginLeft: 'auto' } }),
        h('button', { type: 'button', style: secondary, onClick: onClose, disabled: applying }, 'Close'),
        canApply ? h('button', { type: 'button', style: primary, onClick: install, disabled: applying }, applying ? 'Installing…' : 'Install update') : null,
      ),
      ),
      );
    }

    function useStateSafe(initial) {
      return React.useState(initial);
    }

    function activitySummary(activity) {
      if (!activity || typeof activity !== 'object') return '';
      const commands = Array.isArray(activity.commands) ? activity.commands : [];
      const files = Array.isArray(activity.files) ? activity.files : [];
      const parts = [];
      if (commands.length > 0) {
        const first = String(commands[0]?.command ?? '').trim();
        parts.push(first ? `$ ${first}` : `${commands.length} command${commands.length === 1 ? '' : 's'}`);
      }
      if (files.length > 0) parts.push(`${files.length} file${files.length === 1 ? '' : 's'}`);
      if (activity.declined > 0) parts.push(`${activity.declined} declined`);
      return parts.join(' · ');
    }

    function safeMarkdownHref(value) {
      const href = String(value ?? '').trim();
      return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
    }

    function renderInlineMarkdown(value, prefix = 'inline') {
      const text = String(value ?? '');
      if (!text) return [];
      const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^) \n]+\))/g;
      const nodes = [];
      let cursor = 0;
      let match;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        const token = match[0];
        const key = `${prefix}-${index}`;
        index += 1;
        if (token.startsWith('`') && token.endsWith('`')) {
          nodes.push(h('code', {
            key,
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.92em',
              padding: '1px 4px',
              borderRadius: 4,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
              color: 'var(--dsw-alias-label-primary)',
            },
          }, token.slice(1, -1)));
        } else if (token.startsWith('**') || token.startsWith('__')) {
          nodes.push(h('strong', { key, style: { fontWeight: 650 } }, ...renderInlineMarkdown(token.slice(2, -2), `${key}-s`)));
        } else if (token.startsWith('~~')) {
          nodes.push(h('del', { key, style: { opacity: 0.7 } }, ...renderInlineMarkdown(token.slice(2, -2), `${key}-d`)));
        } else if (token.startsWith('*') || token.startsWith('_')) {
          nodes.push(h('em', { key }, ...renderInlineMarkdown(token.slice(1, -1), `${key}-e`)));
        } else if (token.startsWith('[')) {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
          const href = link ? safeMarkdownHref(link[2]) : null;
          if (link && href) {
            nodes.push(h('a', {
              key,
              href,
              target: '_blank',
              rel: 'noreferrer',
              style: {
                color: 'var(--dsw-alias-label-primary)',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              },
            }, ...renderInlineMarkdown(link[1], `${key}-a`)));
          } else {
            nodes.push(token);
          }
        } else {
          nodes.push(token);
        }
        cursor = match.index + token.length;
      }
      if (cursor < text.length) nodes.push(text.slice(cursor));
      return nodes;
    }

    function renderMarkdown(value, prefix = 'md') {
      const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
      const blocks = [];
      let index = 0;
      let key = 0;
      const nextKey = () => `${prefix}-${key++}`;
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index += 1; continue; }

        const fence = /^\s*```(.*)$/.exec(line);
        if (fence) {
          const code = [];
          index += 1;
          while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
            code.push(lines[index]);
            index += 1;
          }
          if (index < lines.length) index += 1;
          blocks.push(h('pre', {
            key: nextKey(),
            style: {
              margin: '10px 0',
              padding: '10px 12px',
              overflowX: 'auto',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
              color: 'var(--dsw-alias-label-primary)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12.5,
              lineHeight: 1.65,
              whiteSpace: 'pre',
            },
          }, h('code', null, code.join('\n'))));
          continue;
        }

        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        if (heading) {
          const level = heading[1].length;
          blocks.push(h(`h${level}`, {
            key: nextKey(),
            style: {
              margin: blocks.length === 0 ? '0 0 9px' : '16px 0 7px',
              fontSize: level === 1 ? 18 : level === 2 ? 17 : level === 3 ? 16 : 15,
              fontWeight: 650,
              lineHeight: 1.35,
              letterSpacing: '-0.01em',
            },
          }, ...renderInlineMarkdown(heading[2], `${prefix}-h${level}`)));
          index += 1;
          continue;
        }

        if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
          blocks.push(h('hr', {
            key: nextKey(),
            style: {
              margin: '14px 0',
              border: 0,
              borderTop: '1px solid var(--dsw-alias-border-l1)',
            },
          }));
          index += 1;
          continue;
        }

        if (/^\s*>\s?/.test(line)) {
          const quote = [];
          while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
            quote.push(lines[index].replace(/^\s*>\s?/, ''));
            index += 1;
          }
          blocks.push(h('blockquote', {
            key: nextKey(),
            style: {
              margin: '10px 0',
              padding: '2px 0 2px 11px',
              borderLeft: '2px solid var(--dsw-alias-border-l1)',
              color: 'var(--dsw-alias-label-secondary)',
            },
          }, ...renderMarkdown(quote.join('\n'), `${prefix}-quote`)));
          continue;
        }

        const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
        const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
        if (unordered || ordered) {
          const isOrdered = Boolean(ordered);
          const items = [];
          while (index < lines.length) {
            const item = isOrdered ? /^\s*\d+[.)]\s+(.+)$/.exec(lines[index]) : /^\s*[-*+]\s+(.+)$/.exec(lines[index]);
            if (!item) break;
            items.push(item[1]);
            index += 1;
          }
          const listStyle = { margin: '10px 0 12px', paddingLeft: 22, color: 'var(--dsw-alias-label-primary)' };
          blocks.push(h(isOrdered ? 'ol' : 'ul', { key: nextKey(), style: listStyle },
            items.map((item, itemIndex) => h('li', {
              key: `${prefix}-li-${itemIndex}`,
              style: { margin: '3px 0', paddingLeft: 2 },
            }, ...renderInlineMarkdown(item, `${prefix}-li-${itemIndex}`)))));
          continue;
        }

        const paragraph = [];
        while (index < lines.length) {
          const current = lines[index];
          if (!current.trim()) break;
          if (/^\s*```/.test(current) || /^(#{1,4})\s+/.test(current)
            || /^\s*>\s?/.test(current) || /^\s*[-*+]\s+/.test(current)
            || /^\s*\d+[.)]\s+/.test(current) || /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(current)) break;
          paragraph.push(current);
          index += 1;
        }
        if (paragraph.length > 0) {
          blocks.push(h('div', {
            key: nextKey(),
            style: {
              margin: '0 0 12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            },
          }, ...renderInlineMarkdown(paragraph.join('\n'), `${prefix}-p`)));
        }
      }
      return blocks;
    }

    function MarkdownText(props) {
      const { text, style } = props;
      return h('div', {
        style: {
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 15,
          lineHeight: 1.75,
          minWidth: 0,
          wordBreak: 'break-word',
          ...style,
        },
      }, ...renderMarkdown(text, props.prefix ?? 'md'));
    }

    function ThreadRail(props) {
      const { threads, selectedId, onSelect } = props;
      if (!Array.isArray(threads) || threads.length === 0) return null;
      const chip = (thread, compact) => {
        const isSelected = thread.threadId === selectedId;
        const label = thread.label || 'Untitled';
        return h('button', {
          key: thread.threadId,
          type: 'button',
          role: 'tab',
          'aria-selected': isSelected,
          title: `${label}${thread.model ? ` · ${thread.model}` : ''}${thread.active ? ' · active advisor thread' : ''}`,
          onClick: () => onSelect(thread.threadId),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: compact ? 5 : 6,
            maxWidth: compact ? 280 : 260,
            minWidth: 0,
            padding: compact ? '4px 10px' : '6px 11px',
            borderRadius: 999,
            border: isSelected
              ? '1px solid var(--dsw-alias-label-primary)'
              : '1px solid var(--dsw-alias-border-l1)',
            background: isSelected
              ? 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))'
              : 'transparent',
            color: isSelected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            font: 'inherit',
            fontSize: compact ? 11.5 : 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: '0 0 auto',
          },
        },
        h('span', {
          style: {
            width: 6,
            height: 6,
            borderRadius: 99,
            flex: '0 0 auto',
            background: thread.active ? THEME.success : 'var(--dsw-alias-border-l1)',
          },
          title: thread.active ? 'active advisor thread' : 'inactive advisor thread',
        }),
        h('span', {
          style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: compact ? 185 : 165 },
        }, label),
        thread.model ? h('span', {
          style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis' },
        }, `${thread.model}${thread.turnCount ? ` · ${thread.turnCount}` : ''}`) : null);
      };
      if (threads.length === 1) {
        return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '0 0 auto' } },
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, whiteSpace: 'nowrap' } }, 'Thread'),
          chip(threads[0], true));
      }
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, maxWidth: '100%', flex: '0 0 auto' } },
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, whiteSpace: 'nowrap' } }, 'Threads'),
        h('div', {
          role: 'tablist',
          'aria-label': 'Codex threads',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            overflowX: 'auto',
            padding: '1px 1px 3px',
            scrollbarWidth: 'thin',
          },
        }, threads.map((thread) => chip(thread, false))));
    }

    function CodexCard(props) {
      const t = useT(props);
      const sessionId = useActiveSession();
      const updateState = useUpdate();
      const [updateOpen, setUpdateOpen] = React.useState(false);
      const [modalUpdate, setModalUpdate] = React.useState(null);
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

      const checkUpdates = React.useCallback(async () => {
        const next = await updateState.check(true);
        if (next?.updateAvailable) {
          setModalUpdate(next);
          setUpdateOpen(true);
        }
      }, [updateState.check]);

      const threads = Array.isArray(snapshot?.threads) ? snapshot.threads : [];
      const activeThread = threads.find((thread) => thread.active) ?? threads[0] ?? null;
      const failure = snapshot?.last_failure ?? null;
      const answer = typeof snapshot?.last_answer === 'string' ? snapshot.last_answer.trim() : '';
      const lastAsk = typeof snapshot?.last_ask === 'string' ? snapshot.last_ask.trim() : '';
      const failureAt = toDate(failure?.at)?.getTime() ?? 0;
      const answerAt = toDate(snapshot?.last_answer_at)?.getTime() ?? 0;
      const askAt = toDate(snapshot?.last_ask_at)?.getTime() ?? 0;
      const failed = Boolean(failure && failureAt >= answerAt);
      const hasAnswer = !failed && Boolean(answer);
      const hasThread = Boolean(activeThread || snapshot?.thread_id);
      const pending = !failed && !hasAnswer && hasThread && Boolean(lastAsk || askAt);
      const status = !sessionId
        ? 'no-session'
        : failed
          ? 'failed'
          : hasAnswer
            ? 'ready'
            : pending
              ? 'pending'
              : hasThread
                ? 'bound'
                : 'empty';
      const statusLabel = status === 'no-session'
        ? t('statusNoSession')
        : status === 'failed'
          ? t('statusFailed')
          : status === 'ready'
            ? t('statusReady')
            : status === 'pending'
              ? t('statusPending')
              : status === 'bound'
                ? t('statusBound')
                : t('statusEmpty');
      const statusColor = status === 'failed'
        ? THEME.error
        : status === 'ready'
          ? THEME.success
          : (status === 'pending' || status === 'bound')
            ? THEME.warn
            : 'var(--dsw-alias-label-secondary)';
      const when = failed
        ? formatWhen(failure?.at, t)
        : hasAnswer
          ? formatWhen(snapshot?.last_answer_at, t)
          : hasThread
            ? formatWhen(snapshot?.last_ask_at, t)
            : '';
      const version = snapshot?.source?.version ?? updateState.value?.currentVersion ?? null;
      const modelEffort = [activeThread?.model ?? snapshot?.model, activeThread?.effort ?? snapshot?.effort].filter(Boolean).join(' · ');
      const threadLabel = activeThread?.label ?? snapshot?.label ?? null;
      const threadCount = threads.length;
      const turnCount = activeThread?.turnCount ?? snapshot?.asks ?? 0;
      const activity = activitySummary(activeThread?.activity ?? snapshot?.last_activity);
      const answerText = !sessionId
        ? t('cardNoSession')
        : failed
          ? (failure?.message || t('cardFailed'))
          : hasAnswer
            ? answer
            : pending
              ? t('cardWaiting')
              : hasThread
                ? t('cardEmpty')
                : t('cardNoThread');
      const answerColor = failed
        ? THEME.error
        : hasAnswer
          ? 'var(--dsw-alias-label-primary)'
          : 'var(--dsw-alias-label-secondary)';

      return h('div', {
        style: {
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          flex: '0 0 100%',
          order: 1,
          gridColumn: '1 / -1',
          margin: '0 0 6px',
          padding: '9px 10px 8px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1)',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 22px rgba(15, 23, 42, 0.06)',
          color: 'var(--dsw-alias-label-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        },
        role: 'group',
        'aria-label': t('cardTitle'),
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
        h('span', { style: { fontWeight: 650, fontSize: 12.5, whiteSpace: 'nowrap' } }, t('cardTitle')),
        h(VersionBadge, {
          t,
          update: updateState.value,
          checking: updateState.checking,
          onCheck: checkUpdates,
          version,
        }),
        h('div', {
          style: {
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 5,
            minWidth: 0,
            flexShrink: 1,
          },
          title: statusLabel,
          role: 'img',
          'aria-label': statusLabel,
        },
        h('span', { style: { width: 7, height: 7, borderRadius: 99, background: statusColor, flex: '0 0 auto' } }),
        modelEffort ? h('span', {
          style: {
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 9.5,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        }, modelEffort) : null),
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        turnCount > 0 ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 9.5, whiteSpace: 'nowrap' } }, `${turnCount} ${t('rounds')}`) : null,
        threadCount > 1 ? h('span', {
          style: {
            marginLeft: 'auto',
            padding: '1px 6px',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 999,
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 9,
            whiteSpace: 'nowrap',
          },
        }, `${threadCount} threads`) : null,
      ),
      hasThread ? h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 9.5,
          lineHeight: 1.35,
        },
        title: threadLabel ?? '',
      },
        h('span', {
          style: {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          },
        }, `Thread · ${threadLabel ?? 'Untitled'}`),
        when ? h('span', {
          style: { marginLeft: 'auto', whiteSpace: 'nowrap', flex: '0 0 auto' },
        }, when) : null,
      ) : null,
      lastAsk ? h('div', {
        style: {
          minWidth: 0,
          padding: '6px 8px 7px',
          borderRadius: 7,
          background: THEME.askSurface,
        },
      },
        h('div', { style: { color: THEME.accent, fontSize: 9.5, fontWeight: 600, marginBottom: 2 } }, 'Ask'),
        h('div', {
          style: {
            fontSize: 11.5,
            lineHeight: 1.45,
            color: 'var(--dsw-alias-label-primary)',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        }, lastAsk),
      ) : null,
      h('div', {
        style: {
          minWidth: 0,
          padding: '6px 8px 7px',
          borderRadius: 7,
          background: mixColor('var(--dsw-alias-label-primary)', 6, 'var(--dsw-alias-bg-layer-1)'),
        },
      },
        h('div', { style: { color: failed ? THEME.error : 'var(--dsw-alias-label-secondary)', fontSize: 9.5, fontWeight: 600, marginBottom: 2 } }, failed ? 'Failure' : 'Codex'),
        h('div', {
          style: {
            color: answerColor,
            fontSize: 11.5,
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        }, answerText || t('cardNoThread')),
      ),
      (activity || error || loading) ? h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 9,
          minWidth: 0,
        },
      },
        activity ? h('span', { title: activity, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, activity) : null,
        error ? h('span', { title: error, style: { marginLeft: 'auto', color: THEME.error, whiteSpace: 'nowrap' } }, t('error')) : null,
        loading && !snapshot ? h('span', { style: { marginLeft: 'auto', whiteSpace: 'nowrap' } }, t('loading')) : null,
      ) : null,
      updateOpen && modalUpdate ? h(UpdateModal, {
        update: modalUpdate,
        onClose: () => setUpdateOpen(false),
      }) : null,
      );
    }

    function TurnCard(props) {
      const { turn, t } = props;
      const meta = statusMeta(turn.status, t);
      const when = formatWhen(turn.created_at, t);
      const commands = Array.isArray(turn.commands) ? turn.commands : [];
      const files = Array.isArray(turn.files) ? turn.files : [];
      const failed = turn.status === 'failed' || Boolean(turn.error);
      const footnote = [turn.model, turn.effort].filter(Boolean).join(' · ');
      const statusTint = mixColor(meta.color, 13);
      const activityLabel = [
        commands.length > 0 ? `${commands.length} command${commands.length === 1 ? '' : 's'}` : null,
        files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ');
      return h('article', {
        style: {
          position: 'relative',
          padding: '0 0 3px 18px',
          marginBottom: 32,
          minWidth: 0,
        },
      },
      h('div', {
        'aria-hidden': true,
        style: {
          position: 'absolute',
          left: 0,
          top: 2,
          bottom: 2,
          width: 3,
          borderRadius: 999,
          background: failed ? THEME.error : meta.color,
          pointerEvents: 'none',
        },
      }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11, minWidth: 0 } },
        h('span', {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 999,
            background: statusTint,
            color: meta.color,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { width: 6, height: 6, borderRadius: 99, background: meta.color } }),
        meta.label),
        when ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5, whiteSpace: 'nowrap' } }, when) : null,
      ),
      turn.ask ? h('div', {
        style: {
          marginBottom: 18,
          padding: '12px 14px 13px',
          borderRadius: 12,
          background: THEME.askSurface,
          minWidth: 0,
        },
      },
      h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          color: THEME.accent,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.2,
        },
      },
      h('span', { style: { width: 5, height: 5, borderRadius: 99, background: THEME.accent } }),
      'Ask'),
      h(MarkdownText, {
        text: turn.ask,
        prefix: `ask-${turn.turn_id ?? 'turn'}`,
        style: { fontSize: 14, lineHeight: 1.7, maxWidth: 760 },
      }),
      ) : null,
      h('div', {
        style: {
          minWidth: 0,
          padding: '12px 14px 13px',
          borderRadius: 12,
          background: mixColor('var(--dsw-alias-label-primary)', 6, 'var(--dsw-alias-bg-layer-1)'),
        },
      },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: failed ? THEME.error : 'var(--dsw-alias-label-secondary)',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.2,
            marginBottom: 6,
          },
        },
        h('span', { style: { width: 5, height: 5, borderRadius: 99, background: failed ? THEME.error : 'var(--dsw-alias-label-secondary)' } }),
        failed ? 'Failure' : 'Codex'),
        turn.answer ? h(MarkdownText, {
          text: turn.answer,
          prefix: `answer-${turn.turn_id ?? 'turn'}`,
          style: { fontSize: 15, lineHeight: 1.75, maxWidth: 760 },
        }) : failed ? h(MarkdownText, {
          text: turn.error ?? t('noAnswer'),
          prefix: 'turn-failure',
          style: { color: THEME.error, fontSize: 13.5, lineHeight: 1.65, maxWidth: 760 },
        }) : h('div', {
          style: {
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 13.5,
            lineHeight: 1.6,
          },
        }, t('noAnswer')),
      ),
      failed && turn.answer && turn.error ? h('div', {
        style: {
          marginTop: 10,
          padding: '9px 11px',
          borderRadius: 9,
          background: mixColor(THEME.error, 10, 'var(--dsw-alias-bg-layer-1)'),
        },
      }, h(MarkdownText, {
        text: turn.error,
        prefix: 'turn-error',
        style: { color: THEME.error, fontSize: 12.5, lineHeight: 1.6 },
      })) : null,
      (commands.length > 0 || files.length > 0) ? h('details', {
        style: {
          marginTop: 15,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 11.5,
          lineHeight: 1.6,
        },
      },
      h('summary', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 9px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 999,
          cursor: 'pointer',
          userSelect: 'none',
          listStyle: 'none',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 10.5,
        },
      }, `Activity${activityLabel ? ` · ${activityLabel}` : ''}`),
      h('div', { style: { marginTop: 9 } },
        commands.map((command, commandIndex) => h('div', {
          key: commandIndex,
          style: {
            marginTop: commandIndex === 0 ? 0 : 7,
            padding: '8px 10px',
            borderRadius: 7,
            background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11.5,
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, `$ ${command.command ?? ''}${command.status ? `  [${command.status}]` : ''}`)),
        files.length > 0 ? h('div', {
          style: {
            marginTop: commands.length > 0 ? 8 : 0,
            padding: '8px 10px',
            borderRadius: 7,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 11.5,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, files.join('\n')) : null,
      ),
      ) : null,
      footnote ? h('div', {
        style: {
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 15,
          paddingTop: 8,
          borderTop: '1px solid var(--dsw-alias-border-l1)',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 10.5,
          lineHeight: 1.2,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: 0.88,
        },
      }, footnote) : null,
      );
    }

    function CodexView(props) {
      const t = useT(props);
      const active = useActiveSession();
      const sessionId = typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : active;
      const updateState = useUpdate();
      const [updateOpen, setUpdateOpen] = React.useState(false);
      const [modalUpdate, setModalUpdate] = React.useState(null);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [selected, setSelected] = React.useState(null);

      React.useEffect(() => {
        setSelected(null);
        setData(null);
      }, [sessionId]);

      const load = React.useCallback(async () => {
        if (!sessionId) {
          setData(null);
          setError(null);
          return;
        }
        setLoading(true);
        try {
          const value = await getJson(HISTORY_ENDPOINT, {
            session_id: sessionId,
            thread: selected || undefined,
            limit: 20,
          }, { timeoutMs: 60000 });
          setData(value);
          setError(null);
          if (!selected && value?.thread_id) setSelected(value.thread_id);
        } catch (err) {
          setError(err?.message ?? String(err));
        } finally {
          setLoading(false);
        }
      }, [sessionId, selected]);

      React.useEffect(() => { load(); }, [load]);

      const checkUpdates = React.useCallback(async () => {
        const next = await updateState.check(true);
        if (next?.updateAvailable) {
          setModalUpdate(next);
          setUpdateOpen(true);
        }
      }, [updateState.check]);

      const turns = Array.isArray(data?.turns) ? data.turns : [];
      const threads = Array.isArray(data?.threads) ? data.threads : [];
      const currentThread = threads.find((thread) => thread.threadId === (selected ?? data?.thread_id))
        ?? threads.find((thread) => thread.active)
        ?? null;
      const version = data?.source?.version ?? updateState.value?.currentVersion ?? null;
      const lastAt = turns.length > 0 ? turns[turns.length - 1].created_at : null;

      const buttonStyle = {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 9,
        padding: '6px 12px',
        fontSize: 12.5,
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.6 : 1,
      };

      return h('div', {
        style: {
          height: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: '30px 34px 110px',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('div', { style: { maxWidth: 800, margin: '0 auto' } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 } },
          h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
              h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650, letterSpacing: '-0.01em' } }, t('tabTitle')),
              h(VersionBadge, {
                t,
                update: updateState.value,
                checking: updateState.checking,
                notice: updateState.notice,
                onCheck: checkUpdates,
                version,
              }),
            ),
            h('div', { style: { marginTop: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 } },
              threads.length > 0 ? h(ThreadRail, {
                threads,
                selectedId: selected ?? data?.thread_id,
                onSelect: setSelected,
              }) : null,
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, whiteSpace: 'nowrap' } },
                `${turns.length} ${t('rounds')}`),
              lastAt ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, whiteSpace: 'nowrap' } }, formatWhen(lastAt, t)) : null,
            ),
          ),
          h('button', { type: 'button', style: { marginLeft: 'auto', ...buttonStyle }, onClick: load, disabled: loading }, t('refresh')),
        ),
        error ? h('div', {
          style: {
            border: `1px solid ${mixColor(THEME.error, 32, 'var(--dsw-alias-border-l1)')}`,
            borderRadius: 12,
            background: mixColor(THEME.error, 10, 'var(--dsw-alias-bg-layer-1)'),
            color: 'var(--dsw-alias-state-error-primary)',
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.55,
          },
        }, `${t('error')}: ${error}`) : null,
        !error && !sessionId ? h('div', {
          style: {
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '14px 16px',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 12.5,
          },
        }, t('noSession')) : null,
        !error && sessionId && loading && !data ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 } },
          [0, 1, 2].map((index) => h('div', {
            key: index,
            style: {
              height: 12,
              width: index === 0 ? '42%' : (index === 1 ? '78%' : '62%'),
              borderRadius: 99,
              background: 'var(--dsw-alias-border-l1)',
              opacity: 0.55,
            },
          })),
        ) : null,
        !error && sessionId && !loading && turns.length === 0 ? h('div', { style: { maxWidth: 520, margin: '52px auto 0', textAlign: 'center' } },
          h('div', { style: { width: 34, height: 34, margin: '0 auto 14px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
            h('span', { style: { width: 6, height: 6, borderRadius: 99, background: THEME.success } })),
          h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 6 } }, threads.length > 0 ? t('emptyTitle') : t('emptyTitle')),
          h('div', { style: { fontSize: 13.5, lineHeight: 1.65, color: 'var(--dsw-alias-label-secondary)' } }, t('emptyHint')),
        ) : null,
        turns.length > 0 ? h('div', { style: { minWidth: 0 } },
          turns.map((turn) => h(TurnCard, { key: turn.turn_id ?? `${turn.status}-${turn.ask}`, turn, t })),
        ) : null,
        h('div', { style: { marginTop: 26, color: 'var(--dsw-alias-label-secondary)', fontSize: 10.5 } },
          `Codex advisor${version ? ` · v${version}` : ''}${currentThread?.model ? ` · ${currentThread.model}` : ''}`),
        updateOpen && modalUpdate ? h(UpdateModal, {
          update: modalUpdate,
          onClose: () => setUpdateOpen(false),
        }) : null,
      ));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        fallbackT = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh: en, en }), 'dsh-codex-advisor: locale dictionaries');
        const t = ctx.locale.bind(NS);
        fallbackT = t;
        if (typeof window !== 'undefined' && window.__CODEX_ADVISOR_TEST__ === true) {
          window.__codexAdvisorTest = { renderMarkdown, renderInlineMarkdown, ThreadRail, TurnCard };
        }

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
          label: () => t('tab'),
        }, CodexView));
      },
    };
  },
});

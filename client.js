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
      const next = typeof id === 'string' && id ? id : null;
      if (activeSessionId === next) return;
      activeSessionId = next;
      for (const listener of activeSessionListeners) listener();
    }

    function clearActiveSession(id) {
      if (activeSessionId !== id) return;
      setActiveSession(null);
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

    // A split-view host renders one conversation.composer.dock per pane. The
    // session id alone cannot tell which pane has focus, so each probe renders
    // a hidden marker and a document-level focus/pointer resolver picks the
    // pane whose DOM contains the event target. This intentionally has no
    // dependency on a particular split plugin's class names or state.
    //
    // Support boundary: verified against the latest dsh-multiview only (0.1.20,
    // DSH 0.2.2-rc.1). Older split-view releases are not shimmed; when a newer
    // release changes focus semantics, the supported target moves forward.
    const sessionProbes = new Map();
    let sessionProbeListening = false;
    let sessionProbeObserver = null;

    function nearestCommonAncestor(a, b) {
      const seen = new Set();
      for (let node = a; node; node = node.parentElement) seen.add(node);
      for (let node = b; node; node = node.parentElement) {
        if (seen.has(node)) return node;
      }
      return null;
    }

    function elementDepth(node) {
      let depth = 0;
      for (let current = node; current; current = current.parentElement) depth += 1;
      return depth;
    }

    function hasOtherSessionMarker(container, sessionId, probes = sessionProbes) {
      if (!container || typeof container.contains !== 'function') return false;
      for (const [otherId, markers] of probes) {
        if (otherId === sessionId) continue;
        for (const marker of markers) {
          if (container.contains(marker)) return true;
        }
      }
      return false;
    }

    function resolveSessionForTarget(target, probes = sessionProbes, doc = typeof document !== 'undefined' ? document : null) {
      if (!doc) return null;
      if (target && target.nodeType !== 1) target = target.parentElement ?? null;
      if (!target) return null;
      let best = null;
      for (const [id, markers] of probes) {
        for (const marker of markers) {
          const common = nearestCommonAncestor(marker, target);
          if (!common || common === doc.body || common === doc.documentElement) continue;
          // A common ancestor that also contains another session marker is a
          // shared split container/toolbar, not a pane; never switch on it.
          if (hasOtherSessionMarker(common, id, probes)) continue;
          const depth = elementDepth(common);
          if (!best || depth > best.depth || (depth === best.depth && id === activeSessionId)) {
            best = { id, depth };
          }
        }
      }
      return best ? best.id : null;
    }

    function findExplicitFocusedSession(probes = sessionProbes, doc = typeof document !== 'undefined' ? document : null) {
      if (!doc) return null;
      let best = null;
      for (const [id, markers] of probes) {
        for (const marker of markers) {
          for (let node = marker.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
            const focused = node.getAttribute?.('data-focused');
            const selected = node.getAttribute?.('aria-selected');
            if (focused !== 'true' && selected !== 'true') continue;
            // An explicit focus marker inside a shared shell would be
            // ambiguous; let target resolution handle the click instead.
            if (hasOtherSessionMarker(node, id, probes)) continue;
            const priority = focused === 'true' ? 2 : 1;
            const depth = elementDepth(node);
            if (!best || priority > best.priority || (priority === best.priority && depth > best.depth)) {
              best = { id, priority, depth };
            }
            break;
          }
        }
      }
      return best ? best.id : null;
    }

    function syncFocusedSession() {
      const explicit = findExplicitFocusedSession();
      if (explicit) {
        setActiveSession(explicit);
        return;
      }
      if (typeof document !== 'undefined' && document.activeElement) {
        const focused = resolveSessionForTarget(document.activeElement);
        if (focused) setActiveSession(focused);
      }
    }

    function handleSessionFocusEvent(event) {
      const id = resolveSessionForTarget(event.target);
      if (id) setActiveSession(id);
    }

    function ensureSessionProbeListeners() {
      if (sessionProbeListening || typeof document === 'undefined') return;
      sessionProbeListening = true;
      document.addEventListener('focusin', handleSessionFocusEvent, true);
      document.addEventListener('pointerdown', handleSessionFocusEvent, true);
      if (typeof MutationObserver !== 'undefined' && document.body) {
        sessionProbeObserver = new MutationObserver(() => syncFocusedSession());
        sessionProbeObserver.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-focused', 'aria-selected'],
        });
      }
    }

    function releaseSessionProbeListeners() {
      if (!sessionProbeListening || typeof document === 'undefined') return;
      sessionProbeListening = false;
      document.removeEventListener('focusin', handleSessionFocusEvent, true);
      document.removeEventListener('pointerdown', handleSessionFocusEvent, true);
      if (sessionProbeObserver) {
        sessionProbeObserver.disconnect();
        sessionProbeObserver = null;
      }
    }

    function registerSessionProbe(id, marker) {
      if (!id || !marker) return () => {};
      let markers = sessionProbes.get(id);
      if (!markers) {
        markers = new Set();
        sessionProbes.set(id, markers);
      }
      markers.add(marker);
      ensureSessionProbeListeners();
      if (activeSessionId === null || !sessionProbes.has(activeSessionId)) setActiveSession(id);
      syncFocusedSession();
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const current = sessionProbes.get(id);
        if (current) {
          current.delete(marker);
          if (current.size === 0) sessionProbes.delete(id);
        }
        if (activeSessionId === id && !sessionProbes.has(id)) {
          const explicit = findExplicitFocusedSession();
          if (explicit) {
            setActiveSession(explicit);
          } else {
            const focused = typeof document !== 'undefined' && document.activeElement
              ? resolveSessionForTarget(document.activeElement)
              : null;
            if (focused) {
              setActiveSession(focused);
            } else {
              const next = sessionProbes.keys().next();
              if (!next.done) setActiveSession(next.value);
              else clearActiveSession(id);
            }
          }
        }
        if (sessionProbes.size === 0) releaseSessionProbeListeners();
      };
    }

    function SessionProbe(props) {
      const id = typeof props.sessionId === 'string' ? props.sessionId : null;
      const markerRef = React.useRef(null);
      React.useLayoutEffect(() => {
        const marker = markerRef.current;
        if (!marker || !id) return undefined;
        return registerSessionProbe(id, marker);
      }, [id]);
      return h('span', {
        ref: markerRef,
        'data-codex-advisor-session-probe': id || '',
        'aria-hidden': true,
        style: { display: 'none' },
      });
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
      moveToLeft: '移到左侧栏',
      moveToRight: '移到右侧面板',
      installDockHint: '安装面板停靠后可换边',
      installDockTitle: '位置切换需要 dsh-panel-dock',
      installDockBody: '没有面板停靠插件时，Codex 顾问只能固定在左侧边栏，无法换到右侧面板。',
      installDockStrong: '强烈建议安装 dsh-panel-dock：它会接管左右两边的面板布局，提供真正的右侧栏、分栏与位置记忆，其他面板插件也不再需要各自协商。',
      installDockInstall: '一键安装',
      installDockCancel: '取消',
      installDockInstalling: '安装中…',
      installDockInstalled: '已安装，正在重新加载…',
      installDockFailed: '安装失败',
      installDockManual: '手动安装说明',
      quotaWeekly: '周额度',
      quotaFiveHour: '5h 额度',
      quotaUnknown: 'Codex 额度尚未上报',
      approvalNeeded: '需要批准',
      approvalApprove: '批准并发送',
      approvalReject: '拒绝',
      stop: '停止',
      stopHint: '停止当前 Codex 轮次',
      modelLabel: '模型',
      effortLabel: '推理强度',
      followAgent: '跟随',
      prefsNewThread: '切换模型会在下一次提问时开启新线程',
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
      cardTitle: 'Codex Advisor',
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
      moveToLeft: 'Move to left sidebar',
      moveToRight: 'Move to right panel',
      installDockHint: 'Install panel dock to move this card',
      installDockTitle: 'Moving this card needs dsh-panel-dock',
      installDockBody: 'Without the panel dock plugin, Codex Advisor can only stay in the left sidebar.',
      installDockStrong: 'Installing dsh-panel-dock is strongly recommended: it owns panel layout on both sides, provides the real right column, split views and remembered positions, and other panel plugins no longer need to coordinate with each other.',
      installDockInstall: 'Install',
      installDockCancel: 'Cancel',
      installDockInstalling: 'Installing…',
      installDockInstalled: 'Installed; reloading…',
      installDockFailed: 'Install failed',
      installDockManual: 'Manual install',
      quotaWeekly: 'Weekly',
      quotaFiveHour: '5-hour',
      quotaUnknown: 'Codex has not reported quota yet',
      approvalNeeded: 'Approval needed',
      approvalApprove: 'Approve and send',
      approvalReject: 'Reject',
      stop: 'Stop',
      stopHint: 'Stop the running Codex turn',
      modelLabel: 'Model',
      effortLabel: 'Effort',
      followAgent: 'Follow',
      prefsNewThread: 'Switching the model starts a new thread on the next ask',
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
        'aria-label': 'Codex Advisor update',
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
      }, 'Update installed. Quit and reopen DSH to load the new Codex Advisor client.') : null,
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

    // A monochrome ChatGPT mark. The official knot path is far denser than
    // the sparse three-layer Memory mark, so at 13px it reads as a blob at
    // stroke 1.6. The whole official knot is kept (no subpath trimming: that
    // clipped the logo) and drawn at a 1-unit stroke, which lands on a real
    // pixel line instead of the blurry sub-pixel one a thinner stroke gave.
    //
    // Sizing rule: the mark's ink must span the title's cap band, so its top
    // and bottom tangents sit on the cap-top and the baseline. The svg keeps
    // the full 24-unit viewBox (a tight bbox clipped the knot) and is simply
    // drawn smaller: the ink is 20.7 of those 24 units, so this size renders
    // ink at about the 12.5px title's cap height.
    const MARK_VIEWBOX = '0 0 24 24';
    // Paint rule: this asset is a ribbon outline, not a solid silhouette.
    // Stroke alone at small size is sub-pixel, so every gap antialiases to
    // mid-grey and the glyph collapses into a grey ball (measured at cap
    // height: 4 enclosed light pixels, lightest ink 69/255). Filling keeps the
    // negative spaces; adding a light stroke on top gives the ribbons the same
    // weight as the bold title, which is what makes it read at 12px.
    // Sizes are a compromise measured on the real 1.5x renderer: cap height
    // alone (~9px) is legible in shape but reads far lighter than the text.
    const MARK_SIZE = 12;
    const MARK_STROKE = 0.9;
    const CHATGPT_MARK_PATH = 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.073zM13.2599 22.4292a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4943zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';

    function AdvisorMark() {
      return h('span', {
        'aria-hidden': true,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 13px',
          width: 13,
          height: 13,
          lineHeight: 0,
          color: 'var(--dsw-alias-label-primary)',
          // Flex centring aligns the mark box with the title's line box, but
          // the title's cap band sits below that centre, so the mark gets a
          // small downward correction until its ink centre lands on the cap
          // band centre (measured at both 1.5x and 2x).
          transform: 'translateY(-0.15px)',
        },
      }, h('svg', {
        width: MARK_SIZE,
        height: MARK_SIZE,
        viewBox: MARK_VIEWBOX,
        fill: 'none',
        role: 'img',
        'aria-label': 'ChatGPT',
        'data-codex-advisor-mark': 'brand',
        style: { display: 'block' },
      }, h('g', { transform: 'translate(2 2) scale(0.833333)' },
        h('path', {
          d: CHATGPT_MARK_PATH,
          fill: 'currentColor',
          fillRule: 'nonzero',
          stroke: 'currentColor',
          strokeWidth: MARK_STROKE,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }))));
    }

    // Panel geometry belongs to dsh-panel-dock when it is installed. It is an
    // optional dependency: without it the card stays in the left sidebar and
    // the brand switch offers to install it instead of pretending it can move.
    const PANEL_DOCK_ID = 'codex-advisor';
    const PANEL_DOCK_SPEC = 'https://github.com/Awenforever/dsh-panel-dock/archive/refs/tags/v0.4.0.tar.gz';

    function panelDockApi() {
      try {
        return window.__dshPanelDock || null;
      } catch {
        return null;
      }
    }

    function readDockSide() {
      const dock = panelDockApi();
      if (!dock || typeof dock.getSide !== 'function') return 'left';
      try {
        return dock.getSide(PANEL_DOCK_ID) === 'right' ? 'right' : 'left';
      } catch {
        return 'left';
      }
    }

    // dsh-panel-dock has no change subscription yet, so a side changed from its
    // own UI would otherwise leave this glyph pointing the wrong way.
    function useDockSide() {
      const [side, setSide] = React.useState(readDockSide);
      React.useEffect(() => {
        const timer = setInterval(() => {
          const next = readDockSide();
          setSide((previous) => (previous === next ? previous : next));
        }, 1000);
        return () => clearInterval(timer);
      }, []);
      return [side, setSide];
    }

    // A layout glyph, not an arrow: the frame is the panel, the divider is the
    // conversation edge, and the solid band is the side the card will occupy.
    function DockMark({ target }) {
      const toRight = target !== 'left';
      const divider = toRight ? 15.4 : 8.6;
      const bandX = toRight ? 17.1 : 3.9;
      return h('svg', {
        width: 13,
        height: 13,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        'data-codex-advisor-mark': 'switch',
        style: { display: 'block' },
      },
      h('rect', { x: 2.6, y: 4.4, width: 18.8, height: 15.2, rx: 3, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M' + divider + ' 4.4V19.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('rect', { x: bandX, y: 9.4, width: 2.9, height: 5.2, rx: 1.45, fill: 'currentColor' }));
    }

    async function postJson(path, body, options = {}) {
      const timeoutMs = options.timeoutMs ?? 15000;
      const url = new URL(path, document.baseURI);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url.pathname, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        });
        const value = await response.json().catch(() => ({}));
        if (!response.ok || value.ok === false) {
          throw new Error(value.message || value.code || ('HTTP ' + response.status));
        }
        return value;
      } finally {
        clearTimeout(timer);
      }
    }

    let quotaGradientSeq = 0;
    const QUOTA_STOPS = Object.freeze({
      weekly: ['#38bdf8', '#818cf8', '#c084fc'],
      fiveHour: ['#fbbf24', '#fb7185', '#f472b6'],
    });

    function quotaFill(window) {
      if (!window || window.known === false) return null;
      const value = window.remainingPercent;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return Math.max(0, Math.min(100, value)) / 100;
    }

    function quotaTitleOf(quota, t) {
      const weekly = quotaFill(quota && quota.weekly);
      const fiveHour = quotaFill(quota && quota.fiveHour);
      if (weekly === null && fiveHour === null) return t('quotaUnknown');
      const parts = [];
      if (weekly !== null) parts.push(t('quotaWeekly') + ' ' + Math.round(weekly * 100) + '%');
      if (fiveHour !== null) parts.push(t('quotaFiveHour') + ' ' + Math.round(fiveHour * 100) + '%');
      return parts.join(' · ');
    }

    function useElementSize(ref) {
      const [size, setSize] = React.useState(null);
      React.useEffect(function () {
        const node = ref.current;
        if (!node || typeof ResizeObserver !== 'function') return undefined;
        function measure() {
          const rect = node.getBoundingClientRect();
          const width = Math.round(rect.width);
          const height = Math.round(rect.height);
          if (!(width > 0 && height > 0)) return;
          setSize(function (previous) {
            return previous && previous.width === width && previous.height === height
              ? previous
              : { width: width, height: height };
          });
        }
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        measure();
        return function () { observer.disconnect(); };
      }, [ref]);
      return size;
    }

    // One rounded border, two arcs. Short clockwise arc (top centre -> bottom
    // right) is the five-hour window; the long counter-clockwise arc to the same
    // corner is the weekly one. The asymmetry is the semantics, so no legend.
    function quotaArcPaths(width, height, radius, stroke) {
      const inset = stroke / 2;
      const right = width - stroke;
      const bottom = height - stroke;
      const r = Math.max(0, Math.min(radius, right / 2, bottom / 2));
      const cx = width / 2;
      const fiveHour = [
        'M', cx, ' ', inset,
        ' H', right - r,
        ' A', r, ' ', r, ' 0 0 1 ', right, ' ', inset + r,
        ' V', bottom - r,
      ].join('');
      const weekly = [
        'M', cx, ' ', inset,
        ' H', inset + r,
        ' A', r, ' ', r, ' 0 0 0 ', inset, ' ', inset + r,
        ' V', bottom - r,
        ' A', r, ' ', r, ' 0 0 0 ', inset + r, ' ', bottom,
        ' H', right - r,
        ' A', r, ' ', r, ' 0 0 0 ', right, ' ', bottom - r,
      ].join('');
      return { fiveHour: fiveHour, weekly: weekly };
    }

    function QuotaBorder(props) {
      const t = props.t;
      const width = props.width;
      const height = props.height;
      const weekly = quotaFill(props.quota && props.quota.weekly);
      const fiveHour = quotaFill(props.quota && props.quota.fiveHour);
      const idsRef = React.useRef(null);
      if (!idsRef.current) {
        quotaGradientSeq += 1;
        idsRef.current = {
          weekly: 'qa-w-' + quotaGradientSeq,
          fiveHour: 'qa-f-' + quotaGradientSeq,
        };
      }
      const ids = idsRef.current;
      const stroke = 1.5;
      const paths = quotaArcPaths(width, height, 7, stroke);
      function gradient(id, stops) {
        return h('linearGradient', {
          id: id,
          gradientUnits: 'userSpaceOnUse',
          x1: width / 2,
          y1: 0,
          x2: width,
          y2: height,
        }, stops.map(function (color, index) {
          return h('stop', {
            key: index,
            offset: Math.round((index / (stops.length - 1)) * 100) + '%',
            stopColor: color,
          });
        }));
      }
      const track = {
        fill: 'none',
        stroke: 'var(--dsw-alias-border-l1)',
        strokeWidth: stroke,
        pathLength: 1,
        strokeDasharray: '1 2',
      };
      function fill(d, fraction, id) {
        return h('path', {
          d: d,
          fill: 'none',
          stroke: 'url(#' + id + ')',
          strokeWidth: stroke,
          strokeLinecap: 'round',
          pathLength: 1,
          strokeDasharray: fraction + ' 2',
        });
      }
      return h('svg', {
        'aria-hidden': true,
        width: width,
        height: height,
        viewBox: '0 0 ' + width + ' ' + height,
        style: { position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' },
      },
        h('defs', null,
          gradient(ids.weekly, QUOTA_STOPS.weekly),
          gradient(ids.fiveHour, QUOTA_STOPS.fiveHour)),
        h('path', Object.assign({ d: paths.weekly }, track)),
        h('path', Object.assign({ d: paths.fiveHour }, track)),
        weekly === null ? null : fill(paths.weekly, weekly, ids.weekly),
        fiveHour === null ? null : fill(paths.fiveHour, fiveHour, ids.fiveHour));
    }

    // The card answers box: the SVG border is the quota gauge.
    function AnswerBox(props) {
      const ref = React.useRef(null);
      const size = useElementSize(ref);
      return h('div', {
        ref: ref,
        title: quotaTitleOf(props.quota, props.t),
        'data-codex-advisor-answer': '',
        style: { position: 'relative', minWidth: 0, borderRadius: 7, background: props.background },
      },
        size ? h(QuotaBorder, { quota: props.quota, width: size.width, height: size.height, t: props.t }) : null,
        h('div', { style: { position: 'relative', minWidth: 0, padding: '6px 8px 7px' } },
          props.label,
          props.text,
          props.extra || null));
    }

    function CodexCard(props) {

      const t = useT(props);
      // docked = rendered inside dsh-panel-dock; the dock owns geometry and the
      // card only draws its own shell. Otherwise it is the left fallback.
      const docked = props.docked === true;
      const [dockSide, setDockSide] = useDockSide();
      const placement = docked ? dockSide : 'left';
      const active = props.active !== false;
      const [cardHovered, setCardHovered] = React.useState(false);
      const [markHovered, setMarkHovered] = React.useState(false);
      const [installOpen, setInstallOpen] = React.useState(false);
      const sessionId = useActiveSession();
      const updateState = useUpdate();
      const [updateOpen, setUpdateOpen] = React.useState(false);
      const [modalUpdate, setModalUpdate] = React.useState(null);
      const [snapshot, setSnapshot] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const rootRef = React.useRef(null);

      const load = React.useCallback(async () => {
        if (!active) return;
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
      }, [sessionId, active]);

      // A pending approval is a live question for the user: poll fast enough
      // that the √/× appears while the tool call is still waiting.
      const pendingApprovalId = snapshot && snapshot.pending_approval ? snapshot.pending_approval.id : null;
      React.useEffect(() => {
        if (!active) return undefined;
        load();
        const timer = setInterval(load, pendingApprovalId ? 5000 : 30000);
        return () => clearInterval(timer);
      }, [load, active, pendingApprovalId]);

      const checkUpdates = React.useCallback(async () => {
        const next = await updateState.check(true);
        if (next?.updateAvailable) {
          setModalUpdate(next);
          setUpdateOpen(true);
        }
      }, [updateState.check]);

      if (!active) return null;

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
      const dockTarget = placement === 'right' ? 'left' : 'right';
      const dockApi = panelDockApi();
      // The brand mark doubles as the dock switch: the ChatGPT glyph at rest,
      // the panel glyph while the card or the mark is hovered or focused. No
      // extra control is added, so the header's trailing status/model cluster
      // keeps its space. Without dsh-panel-dock the same control explains how
      // to get the feature instead of silently doing nothing.
      const showSwitch = cardHovered || markHovered;
      const markLabel = dockApi
        ? (placement === 'right' ? t('moveToLeft') : t('moveToRight'))
        : t('installDockHint');
      const markButton = h('button', {
        type: 'button',
        'data-codex-advisor-position-toggle': '',
        'aria-label': markLabel,
        title: markLabel,
        onClick: () => {
          const dock = panelDockApi();
          if (!dock) {
            setInstallOpen(true);
            return;
          }
          try {
            const next = dock.toggleSide(PANEL_DOCK_ID);
            setDockSide(next === 'right' ? 'right' : 'left');
          } catch {
            setInstallOpen(true);
          }
        },
        onMouseEnter: () => setMarkHovered(true),
        onMouseLeave: () => setMarkHovered(false),
        onFocus: () => setMarkHovered(true),
        onBlur: () => setMarkHovered(false),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
          padding: 0,
          margin: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          lineHeight: 0,
          cursor: 'pointer',
        },
      }, showSwitch ? h(DockMark, { target: dockTarget }) : h(AdvisorMark));
      const cardHoverProps = {
        onMouseEnter: () => setCardHovered(true),
        onMouseLeave: () => { setCardHovered(false); setMarkHovered(false); },
      };

      const pendingApproval = snapshot ? snapshot.pending_approval : null;
      const decideApproval = function (id, decision) {
        postJson('plugins/dsh-codex-advisor/approval', { id: id, decision: decision })
          .then(function () { return load(); })
          .catch(function (err) { setError(err && err.message ? err.message : String(err)); });
      };
      const approvalButtonStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        padding: 0,
        margin: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 4,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 11,
        lineHeight: '14px',
        cursor: 'pointer',
        flex: '0 0 auto',
      };
      const approvalRow = pendingApproval ? h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, minWidth: 0 },
      },
        h('span', {
          title: pendingApproval.preview || '',
          style: {
            flex: '1 1 auto',
            minWidth: 0,
            color: THEME.warn,
            fontSize: 9.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        }, t('approvalNeeded') + ' · ' + pendingApproval.model + (pendingApproval.effort ? ' · ' + pendingApproval.effort : '')),
        h('button', {
          type: 'button',
          title: t('approvalApprove'),
          'data-codex-advisor-approve': '',
          style: approvalButtonStyle,
          onClick: function () { decideApproval(pendingApproval.id, 'approve'); },
        }, '√'),
        h('button', {
          type: 'button',
          title: t('approvalReject'),
          'data-codex-advisor-reject': '',
          style: approvalButtonStyle,
          onClick: function () { decideApproval(pendingApproval.id, 'reject'); },
        }, '×')) : null;

      const prefsModel = (snapshot && snapshot.prefs && snapshot.prefs.model) || '';
      const prefsEffort = (snapshot && snapshot.prefs && snapshot.prefs.effort) || '';
      const savePrefs = function (kind, value) {
        if (!sessionId) return;
        const body = { session_id: sessionId };
        body[kind] = value;
        postJson('plugins/dsh-codex-advisor/prefs', body)
          .then(function () { return load(); })
          .catch(function (err) { setError(err && err.message ? err.message : String(err)); });
      };
      const prefsSelectStyle = {
        fontSize: 9.5,
        height: 18,
        padding: '0 2px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 5,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        maxWidth: 84,
        cursor: 'pointer',
      };
      const prefsRow = h('div', {
        'data-codex-advisor-prefs': '',
        style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 },
      },
        h('select', {
          value: prefsModel,
          title: t('prefsNewThread'),
          style: prefsSelectStyle,
          onChange: function (event) { savePrefs('model', event.target.value); },
        }, [['', t('followAgent')], ['astra', 'astra'], ['sol', 'sol'], ['terra', 'terra'], ['luna', 'luna']].map(function (entry) {
          return h('option', { key: entry[0] || 'auto', value: entry[0] }, entry[1]);
        })),
        h('select', {
          value: prefsEffort,
          title: t('effortLabel'),
          style: prefsSelectStyle,
          onChange: function (event) { savePrefs('effort', event.target.value); },
        }, [['', t('followAgent')], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max'], ['ultra', 'ultra']].map(function (entry) {
          return h('option', { key: entry[0] || 'auto', value: entry[0] }, entry[1]);
        })));

      // dsh-panel-dock passes its own props (including a geometry style) and
      // owns the panel slot; spread them onto the single root and keep style
      // last so the dock's width/flex wins. The fallback path positions itself
      // in the left sidebar and needs no host-ancestor mutation.
      const dockStyle = docked ? (props.style || {}) : null;
      const dockRest = {};
      if (docked) {
        for (const key of Object.keys(props)) {
          if (key !== 'style' && key !== 'docked') dockRest[key] = props[key];
        }
      }
      // Fallback stays in normal flow: it is an ordinary sidebar footer card and
      // the host's footer row decides where it sits. No fixed positioning and no
      // host-ancestor rewriting.
      const fallbackStyle = docked ? null : { width: '100%' };
      const rootStyle = Object.assign({
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '10px 9px 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        // Docked right, the card keeps the sidebar's own fill so it reads as
        // the same surface moved sideways, not a white floating window.
        background: placement === 'right'
          ? 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-module-platform))'
          : 'var(--dsw-alias-bg-layer-1)',
        boxShadow: '0 3px 12px rgba(0, 0, 0, 0.16)',
        color: 'var(--dsw-alias-label-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        fontVariantNumeric: 'tabular-nums',
      }, fallbackStyle || {}, dockStyle || {});

      return h('div', Object.assign({}, dockRest, {
        ref: rootRef,
        'data-codex-advisor-card': true,
        'data-codex-advisor-placement': placement,
        'data-codex-advisor-docked': docked ? 'panel-dock' : 'fallback',
        style: rootStyle,
        role: 'group',
        'aria-label': t('cardTitle'),
        ...cardHoverProps,
      }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        markButton,
        // The line box matches the 13px mark box so the title's cap-height
        // center and the mark's ink center coincide by construction, instead
        // of inheriting whatever line-height the host happens to set.
        h('span', {
          style: {
            fontWeight: 700,
            fontSize: 13,
            lineHeight: '13px',
            letterSpacing: '-0.01em',
            color: 'var(--dsw-alias-label-primary)',
            whiteSpace: 'nowrap',
          },
        }, t('cardTitle')),
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
        title: threadLabel ?? '',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 11,
          lineHeight: 1.3,
        },
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
            fontSize: 11,
            lineHeight: 1.3,
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
      h(AnswerBox, {
        quota: snapshot && snapshot.quota,
        t: t,
        background: mixColor('var(--dsw-alias-label-primary)', 6, 'var(--dsw-alias-bg-layer-1)'),
        label: h('div', {
          style: {
            color: failed ? THEME.error : 'var(--dsw-alias-label-secondary)',
            fontSize: 9.5,
            fontWeight: 600,
            marginBottom: 2,
          },
        }, failed ? 'Failure' : 'Codex'),
        text: h('div', {
          style: {
            color: answerColor,
            fontSize: 11,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        }, answerText || t('cardNoThread')),
        extra: approvalRow,
      }),
      prefsRow,
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
      installOpen ? h(InstallPanelDockModal, {
        t,
        onClose: () => setInstallOpen(false),
      }) : null,
      );
    }

    async function installPanelDock() {
      const url = new URL('plugins/dsh-codex-advisor/install-panel-dock', document.baseURI);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetch(url.pathname, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ spec: PANEL_DOCK_SPEC }),
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

    function InstallPanelDockModal({ t, onClose }) {
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [done, setDone] = React.useState(false);
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !busy) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [busy, onClose]);
      const install = async () => {
        if (busy || done) return;
        setBusy(true);
        setError(null);
        try {
          await installPanelDock();
          setDone(true);
          setTimeout(() => { try { window.location.reload(); } catch { /* reload may be blocked */ } }, 1200);
        } catch (err) {
          setError(err?.message ?? String(err));
        } finally {
          setBusy(false);
        }
      };
      return h('div', {
        'data-codex-advisor-install-modal': '',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('installDockTitle'),
        onClick: (event) => { if (event.target === event.currentTarget && !busy) onClose(); },
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: 'rgba(0, 0, 0, 0.34)',
        },
      },
      h('div', {
        style: {
          width: '100%',
          maxWidth: 430,
          padding: '16px 16px 13px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        },
      },
      h('div', { style: { fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' } }, t('installDockTitle')),
      h('div', { style: { fontSize: 11.5, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' } }, t('installDockBody')),
      h('div', {
        style: {
          fontSize: 11.5,
          lineHeight: 1.5,
          padding: '7px 9px',
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-module-platform)',
          color: 'var(--dsw-alias-label-primary)',
        },
      }, t('installDockStrong')),
      done ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-state-success-primary)' } }, t('installDockInstalled')) : null,
      error ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-word' } }, `${t('installDockFailed')}: ${error}`) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('a', {
          href: 'https://github.com/Awenforever/dsh-panel-dock',
          target: '_blank',
          rel: 'noreferrer',
          style: { marginRight: 'auto', fontSize: 10.5, color: 'var(--dsw-alias-link)' },
        }, t('installDockManual')),
        h('button', {
          type: 'button',
          disabled: busy || done,
          onClick: onClose,
          style: { fontSize: 11.5, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: busy ? 'default' : 'pointer' },
        }, t('installDockCancel')),
        h('button', {
          type: 'button',
          disabled: busy || done,
          onClick: install,
          'data-codex-advisor-install-confirm': '',
          style: { fontSize: 11.5, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--dsw-alias-link)', background: 'var(--dsw-alias-link)', color: 'var(--dsw-alias-bg-layer-1)', cursor: busy ? 'default' : 'pointer' },
        }, busy ? t('installDockInstalling') : t('installDockInstall')),
      )));
    }

    // dsh-panel-dock owns the right column and the left stack. The panel
    // component only draws the card: one root, dock props spread, style last.
    function AdvisorPanel(props) {
      return h(CodexCard, Object.assign({}, props, { docked: true }));
    }

    // Without the dock the card stays in the left sidebar and cannot move.
    function LeftFallback(props) {
      return h(CodexCard, Object.assign({}, props, { docked: false, active: true }));
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
      // A pane-owned view keeps its own session; focus only changes the
      // fallback for views that did not receive a sessionId from the host.
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

      const stopTurn = React.useCallback(async () => {
        if (!sessionId) return;
        try {
          await postJson('plugins/dsh-codex-advisor/cancel', { session_id: sessionId }, { timeoutMs: 20000 });
          await load();
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        }
      }, [sessionId, load]);

      const decideApproval = React.useCallback(async (id, decision) => {
        try {
          await postJson('plugins/dsh-codex-advisor/approval', { id: id, decision: decision });
          await load();
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        }
      }, [load]);

      const savePrefs = React.useCallback(async (kind, value) => {
        if (!sessionId) return;
        const body = { session_id: sessionId };
        body[kind] = value;
        try {
          await postJson('plugins/dsh-codex-advisor/prefs', body);
          await load();
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        }
      }, [sessionId, load]);

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

      const selectStyle = {
        fontSize: 12,
        height: 28,
        padding: '0 6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      };
      const activeTurn = data && data.active_turn ? data.active_turn : null;
      const pendingApproval = data && data.pending_approval ? data.pending_approval : null;

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
          h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('select', {
              value: (data && data.prefs && data.prefs.model) || '',
              title: t('prefsNewThread'),
              style: selectStyle,
              onChange: function (event) { savePrefs('model', event.target.value); },
            }, [['', t('followAgent')], ['astra', 'astra'], ['sol', 'sol'], ['terra', 'terra'], ['luna', 'luna']].map(function (entry) {
              return h('option', { key: entry[0] || 'auto', value: entry[0] }, entry[1]);
            })),
            h('select', {
              value: (data && data.prefs && data.prefs.effort) || '',
              title: t('effortLabel'),
              style: selectStyle,
              onChange: function (event) { savePrefs('effort', event.target.value); },
            }, [['', t('followAgent')], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max'], ['ultra', 'ultra']].map(function (entry) {
              return h('option', { key: entry[0] || 'auto', value: entry[0] }, entry[1]);
            })),
            activeTurn ? h('button', {
              type: 'button',
              'data-codex-advisor-stop': '',
              title: t('stopHint'),
              style: buttonStyle,
              onClick: stopTurn,
            }, t('stop')) : null,
            h('button', { type: 'button', style: buttonStyle, onClick: load, disabled: loading }, t('refresh'))),
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
        pendingApproval ? h('div', {
          'data-codex-advisor-approval': '',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            border: '1px solid ' + mixColor(THEME.warn, 40, 'var(--dsw-alias-border-l1)'),
            background: mixColor(THEME.warn, 10, 'var(--dsw-alias-bg-layer-1)'),
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 14,
            fontSize: 12,
          },
        },
          h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('approvalNeeded') + ' · ' + pendingApproval.model + (pendingApproval.effort ? ' · ' + pendingApproval.effort : '')),
            h('div', { style: { marginTop: 3, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } }, pendingApproval.preview || '')),
          h('button', { type: 'button', style: buttonStyle, onClick: function () { decideApproval(pendingApproval.id, 'reject'); } }, '× ' + t('approvalReject')),
          h('button', { type: 'button', style: buttonStyle, onClick: function () { decideApproval(pendingApproval.id, 'approve'); } }, '√ ' + t('approvalApprove'))) : null,
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
          `Codex Advisor${version ? ` · v${version}` : ''}${currentThread?.model ? ` · ${currentThread.model}` : ''}`),
        updateOpen && modalUpdate ? h(UpdateModal, {
          update: modalUpdate,
          onClose: () => setUpdateOpen(false),
        }) : null,
      ));
    }

    // Register either a panel-dock panel or the left fallback. The dock is
    // optional; when it appears late the fallback is removed and the real
    // panel takes over, without reloading the page.
    function registerPanelSurface(ctx, t) {
      let disposed = false;
      let dockDispose = null;
      let fallbackDispose = null;
      let timer = 0;

      const registerFallback = () => {
        if (disposed || fallbackDispose) return;
        fallbackDispose = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'codex-advisor-card',
          order: 20,
          locale: NS,
          inject: () => ({ t }),
        }, LeftFallback)) || null;
      };

      const useDock = (dock) => {
        if (dockDispose || disposed) return;
        try {
          const dispose = dock.define({
            id: PANEL_DOCK_ID,
            title: 'Codex Advisor',
            order: 20,
            side: 'left',
            height: 'auto',
            // 240px truncated the status cluster on a real 1920px window; 260px is
            // the measured floor, so declare it instead of letting the dock squeeze.
            minWidth: 260,
            component: AdvisorPanel,
          });
          dockDispose = typeof dispose === 'function' ? dispose : () => {};
          if (fallbackDispose) {
            try { fallbackDispose(); } catch { /* ignore */ }
            fallbackDispose = null;
          }
        } catch (err) {
          try { console.warn('[codex-advisor] panel-dock define failed', err); } catch { /* ignore */ }
          registerFallback();
        }
      };

      const poll = (attempt) => {
        if (disposed || dockDispose) return;
        const dock = panelDockApi();
        if (dock && typeof dock.define === 'function') {
          useDock(dock);
          return;
        }
        if (attempt >= 30) return;
        timer = setTimeout(() => poll(attempt + 1), 100);
      };

      // If the dock is already up, use it without mounting the fallback first;
      // otherwise show the left card immediately and upgrade in place if the
      // dock is merely slower to publish its global.
      const initial = panelDockApi();
      if (initial && typeof initial.define === 'function') {
        useDock(initial);
      } else {
        registerFallback();
        poll(0);
      }

      return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
        if (dockDispose) try { dockDispose(); } catch { /* ignore */ }
        if (fallbackDispose) try { fallbackDispose(); } catch { /* ignore */ }
        dockDispose = null;
        fallbackDispose = null;
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        fallbackT = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh: en, en }), 'dsh-codex-advisor: locale dictionaries');
        const t = ctx.locale.bind(NS);
        fallbackT = t;

        if (typeof window !== 'undefined' && window.__CODEX_ADVISOR_TEST__ === true) {
          window.__codexAdvisorTest = {
            renderMarkdown,
            renderInlineMarkdown,
            ThreadRail,
            TurnCard,
            AdvisorMark,
            DockMark,
            AdvisorPanel,
            LeftFallback,
            CHATGPT_MARK_PATH,
            readDockSide,
            panelDockApi,
            en,
            SessionProbe,
            getActiveSession,
            setActiveSession,
            nearestCommonAncestor,
            resolveSessionForTarget,
            findExplicitFocusedSession,
            registerSessionProbe,
          };
        }

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'codex-advisor-session-probe',
          order: -1000,
        }, SessionProbe));

        ctx.effect(() => registerPanelSurface(ctx, t), 'dsh-codex-advisor: panel surface');

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

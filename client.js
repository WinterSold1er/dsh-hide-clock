/**
 * dsh-hide-clock browser half: hides the message-row clock in the DSH Web GUI.
 *
 * DOM facts (packages/client/ui-chat/src/client/chat/MessageIconActions.tsx):
 * - the actions row is `<div data-clock="start" | "end">` (line 83);
 * - with `clock === 'start'` the clock span is the row's first child (line 84,
 *   rendered only when `time !== undefined`);
 * - with `clock === 'end'` the clock span is the last child of `span.endInfo`,
 *   which is the row's last child (lines 110-112).
 * CSS-module class names are hashed, so only `[data-clock]` and that structure
 * are load-bearing. The copy/branch controls are `<button>`, so the start rule
 * cannot hit them when the clock is absent.
 *
 * Single-instance by design: one injected style, one media listener, one
 * settings row. A duplicate apply() is a no-op instead of stacking a second
 * copy; the loader disposes the old fiber before applying again (HMR).
 */
window.__ModuleLoader__.load({
  id: 'dsh-hide-clock',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-hide-clock';
    const STORAGE_KEY = 'dsh-hide-clock';
    const MOBILE_QUERY = '(max-width: 768px)';
    const MARKER_ATTR = 'data-dsh-hide-clock';
    const STYLE_MARKER = 'data-dsh-hide-clock-style';
    const DEFAULT_STATE = { hidden: true, mobileOnly: false };

    const STYLE_TEXT =
      '[data-dsh-hide-clock] [data-clock="start"] > span:first-child { display: none !important; }\n' +
      '[data-dsh-hide-clock] [data-clock="end"] > span:last-child > span:last-child { display: none !important; }\n';

    const MESSAGES = {
      en: { hide: 'Hide message clock', mobileOnly: 'Only on mobile' },
      zh: { hide: '隐藏消息时刻', mobileOnly: '仅在移动端生效' },
    };

    /** Live instance; non-null while the owning fiber is applied. */
    let instance = null;

    /**
     * `localStorage` access itself can throw (private mode / blocked cookies).
     * Treat that as "no persistence": settings keep working in memory.
     * @returns {Storage | null} the storage area, or null when unusable.
     */
    function readStorage() {
      try {
        const storage = window.localStorage;
        return storage === undefined || storage === null ? null : storage;
      } catch (error) {
        console.warn('dsh-hide-clock: localStorage unavailable', error);
        return null;
      }
    }

    /** Coerce stored JSON into a valid state; anything unusable falls back to defaults. */
    function readState(storage) {
      if (storage === null) return { ...DEFAULT_STATE };
      let raw;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch (error) {
        // Reading blocked (e.g. SecurityError) is not a settings problem.
        console.warn('dsh-hide-clock: cannot read settings', error);
        return { ...DEFAULT_STATE };
      }
      if (raw === null) return { ...DEFAULT_STATE };
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        // Dirty value from another version or hand editing: defaults win.
        return { ...DEFAULT_STATE };
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...DEFAULT_STATE };
      }
      return {
        hidden: typeof parsed.hidden === 'boolean' ? parsed.hidden : DEFAULT_STATE.hidden,
        mobileOnly: typeof parsed.mobileOnly === 'boolean' ? parsed.mobileOnly : DEFAULT_STATE.mobileOnly,
      };
    }

    /** Persist best-effort: a full/blocked storage must not break the live toggle. */
    function writeState(storage, state) {
      if (storage === null) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        console.warn('dsh-hide-clock: cannot persist settings', error);
      }
    }

    /** Settings row: two checkboxes bound to the live state. */
    function SettingsRow(props) {
      const state = React.useSyncExternalStore(props.subscribe, props.get);
      return h(
        'div',
        { style: { display: 'grid', gap: '8px', padding: '12px 0' } },
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('input', {
            type: 'checkbox',
            checked: state.hidden,
            onChange: (event) => { props.setHidden(event.target.checked); },
          }),
          h('span', null, props.t('hide')),
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', opacity: state.hidden ? 1 : 0.5 } },
          h('input', {
            type: 'checkbox',
            checked: state.mobileOnly,
            disabled: !state.hidden,
            onChange: (event) => { props.setMobileOnly(event.target.checked); },
          }),
          h('span', null, props.t('mobileOnly')),
        ),
      );
    }

    /**
     * Create the live instance: state, style, marker sync and media listener.
     * @returns {object} instance handle with get/subscribe/update/dispose.
     */
    function createInstance() {
      // Missing matchMedia (old or stripped webview) behaves as desktop.
      const media = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null;
      const storage = readStorage();
      const subscribers = new Set();
      let state = readState(storage);

      const isMobile = () => media !== null && media.matches === true;

      // Effective hiding: mobile-only mode defers to the live media query.
      const sync = () => {
        const hide = state.hidden && (!state.mobileOnly || isMobile());
        if (hide) document.documentElement.setAttribute(MARKER_ATTR, '');
        else document.documentElement.removeAttribute(MARKER_ATTR);
      };

      const onMediaChange = () => { sync(); };
      if (media !== null) media.addEventListener('change', onMediaChange);

      const style = document.createElement('style');
      style.setAttribute(STYLE_MARKER, '');
      style.textContent = STYLE_TEXT;
      document.head.appendChild(style);

      sync();

      return {
        get: () => state,
        subscribe: (listener) => {
          subscribers.add(listener);
          return () => { subscribers.delete(listener); };
        },
        update: (patch) => {
          state = { ...state, ...patch };
          writeState(storage, state);
          sync();
          for (const listener of [...subscribers]) listener();
        },
        dispose: () => {
          if (media !== null) media.removeEventListener('change', onMediaChange);
          style.remove();
          document.documentElement.removeAttribute(MARKER_ATTR);
        },
      };
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (instance !== null) {
          // Loader disposal always precedes a re-apply; a stray duplicate apply
          // must not stack a second style, listener or settings row.
          console.warn('dsh-hide-clock: already applied; ignoring duplicate apply');
          return;
        }
        const created = createInstance();
        instance = created;
        ctx.effect(() => () => {
          created.dispose();
          if (instance === created) instance = null;
        }, 'dsh-hide-clock: style, marker, media listener and state');

        ctx.effect(() => ctx.locale.register(NS, 'en', MESSAGES.en), 'dsh-hide-clock: en dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'zh', MESSAGES.zh), 'dsh-hide-clock: zh dictionary');

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'hide-clock',
          order: 50,
          locale: NS,
          inject: () => ({
            get: created.get,
            subscribe: created.subscribe,
            setHidden: (value) => { created.update({ hidden: value }); },
            setMobileOnly: (value) => { created.update({ mobileOnly: value }); },
          }),
        }, SettingsRow));
      },
    };
  },
});

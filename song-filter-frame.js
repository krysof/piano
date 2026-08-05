(() => {
  const normalize = value => globalThis.FreezaSongSearch?.normalize?.(value)
    || String(value || '').normalize('NFKC').toLocaleLowerCase('und').trim();

  let frame = null;
  let title = null;
  let subtitle = null;
  let searchWrap = null;
  let searchInput = null;
  let options = null;
  let empty = null;
  let activeSelect = null;
  let activeTrigger = null;
  let optionSnapshot = [];

  function triggerFor(select) {
    return document.querySelector(`[data-filter-target="${select?.id || ''}"]`);
  }

  function sync(select) {
    if (!select) return;
    const trigger = triggerFor(select);
    const selected = select.selectedOptions?.[0];
    const label = trigger?.querySelector('[data-filter-label]');
    if (label) {
      label.toggleAttribute('data-i18n-skip', select.id === 'songArtistFilter' && selected?.value !== 'all');
      label.textContent = selected?.textContent || '请选择';
    }
    trigger?.classList.toggle('has-selection', Boolean(select.value && select.value !== 'all'));
  }

  function syncAll() {
    document.querySelectorAll('.song-filter-native').forEach(sync);
  }

  function render(query = '') {
    if (!options) return;
    const folded = normalize(query);
    const visible = folded
      ? optionSnapshot.filter(option => normalize(option.label).includes(folded))
      : optionSnapshot;
    options.replaceChildren(...visible.map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'song-filter-option';
      button.dataset.value = option.value;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.value === activeSelect?.value));
      const label = document.createElement('span');
      if (activeSelect?.id === 'songArtistFilter' && option.value !== 'all') label.dataset.i18nSkip = 'true';
      const pieces = option.label.split(/\s*·\s*/);
      label.textContent = pieces[0];
      const count = document.createElement('small');
      count.textContent = pieces.slice(1).join(' · ');
      const mark = document.createElement('i');
      mark.textContent = option.value === activeSelect?.value ? '✓' : '→';
      button.append(label, count, mark);
      return button;
    }));
    empty.hidden = visible.length > 0;
    if (!folded) {
      requestAnimationFrame(() => options.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (!frame || frame.hidden) return;
    frame.classList.remove('visible');
    document.body.classList.remove('song-filter-frame-open');
    const previousTrigger = activeTrigger;
    window.setTimeout(() => {
      frame.hidden = true;
      activeSelect = null;
      activeTrigger = null;
      optionSnapshot = [];
      if (restoreFocus) previousTrigger?.focus({ preventScroll: true });
    }, 180);
  }

  function open(trigger) {
    const select = document.getElementById(trigger.dataset.filterTarget || '');
    if (!select || !frame) return;
    activeSelect = select;
    activeTrigger = trigger;
    optionSnapshot = Array.from(select.options, option => ({ value: option.value, label: option.textContent }));
    title.textContent = trigger.dataset.filterTitle || '选择筛选条件';
    subtitle.textContent = `${optionSnapshot.length} 个选项`;
    const searchable = trigger.dataset.filterSearch === 'true' || optionSnapshot.length > 12;
    searchWrap.hidden = !searchable;
    searchInput.value = '';
    searchInput.placeholder = trigger.dataset.filterPlaceholder || '输入文字过滤';
    frame.hidden = false;
    document.body.classList.add('song-filter-frame-open');
    render();
    requestAnimationFrame(() => {
      frame.classList.add('visible');
      (searchable ? searchInput : options.querySelector('[aria-selected="true"]'))?.focus({ preventScroll: true });
    });
  }

  function mount() {
    frame = document.getElementById('songFilterFrame');
    if (!frame || frame.dataset.mounted === 'true') {
      syncAll();
      return;
    }
    frame.dataset.mounted = 'true';
    title = frame.querySelector('#songFilterFrameTitle');
    subtitle = frame.querySelector('#songFilterFrameSubtitle');
    searchWrap = frame.querySelector('.song-filter-frame-search');
    searchInput = frame.querySelector('#songFilterFrameSearch');
    options = frame.querySelector('#songFilterFrameOptions');
    empty = frame.querySelector('#songFilterFrameEmpty');

    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-filter-target]');
      if (trigger) open(trigger);
    });
    frame.addEventListener('click', event => {
      if (event.target.closest('[data-filter-close]')) {
        close();
        return;
      }
      const option = event.target.closest('.song-filter-option');
      if (!option || !activeSelect) return;
      activeSelect.value = option.dataset.value;
      activeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      sync(activeSelect);
      close();
    });
    searchInput.addEventListener('input', () => render(searchInput.value));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !frame.hidden) close();
    });
    syncAll();
  }

  globalThis.FreezaSongFilterFrame = Object.freeze({ mount, sync, syncAll, close });
})();

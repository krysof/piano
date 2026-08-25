(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const dialog = () => $('liberLiveDeviceDialog');
  const button = () => $('liberLiveConnectBtn');
  const statusLabel = () => $('liberLiveStartStatus');
  let currentPayload = null;
  let preparedSongKey = '';
  let stagedSongKey = '';
  let preparePromise = null;
  let preparePromiseKey = '';

  function closeDialog() {
    const frame = dialog();
    if (frame) frame.hidden = true;
  }

  function openDialog() {
    const frame = dialog();
    if (frame) frame.hidden = false;
  }

  function renderDevices(status) {
    const list = $('liberLiveDeviceList');
    if (!list) return;
    list.replaceChildren();
    if (status.error) {
      const error = document.createElement('div');
      error.className = 'liberlive-device-empty error';
      error.textContent = status.error;
      list.append(error);
    }
    if (!status.devices?.length) {
      const empty = document.createElement('div');
      empty.className = 'liberlive-device-empty';
      empty.textContent = status.scanning ? '正在寻找附近的 LiberLive 琴…' : '没有发现设备，请确认琴已开机并靠近手机。';
      list.append(empty);
      return;
    }
    status.devices.forEach(device => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'liberlive-device-item';
      const title = document.createElement('b');
      title.textContent = device.name || 'LiberLive';
      const detail = document.createElement('small');
      detail.textContent = device.id || 'BLE 控制设备';
      const arrow = document.createElement('i');
      arrow.textContent = '连接';
      item.append(title, detail, arrow);
      item.addEventListener('click', async () => {
        item.disabled = true;
        try {
          await window.FreezaLiberLive.connect(device.id);
          closeDialog();
        } catch {
          item.disabled = false;
        }
      });
      list.append(item);
    });
  }

  function render(status) {
    const connectButton = button();
    const label = statusLabel();
    if (!connectButton || !label) return;
    connectButton.classList.toggle('connected', status.connected);
    connectButton.classList.toggle('connecting', status.connecting || status.scanning);
    connectButton.classList.toggle('unsupported', !status.supported);
    if (status.connected) label.textContent = '原琴已连接 · 手动模式';
    else if (status.connecting) label.textContent = '正在建立控制连接…';
    else if (status.scanning) label.textContent = '正在扫描原版琴…';
    else if (status.error) label.textContent = status.error;
    else if (!status.supported) label.textContent = '请使用 Freeza Live App';
    else label.textContent = '点击扫描 C1 / C2 / U1';
    const disconnect = $('liberLiveDisconnectBtn');
    const scanButton = $('liberLiveScanBtn');
    if (disconnect) disconnect.hidden = !status.connected;
    if (scanButton) scanButton.hidden = status.connected;
    if (!status.connected) {
      currentPayload = null;
      preparedSongKey = '';
      stagedSongKey = '';
    }
    renderDevices(status);
  }

  function songKey(info) {
    if (!info?.bytes?.length) return '';
    return `${info.songId || info.title || ''}:${info.bytes.length}`;
  }

  async function stageDeviceSongStream({ onProgress } = {}) {
    let status = window.FreezaLiberLive?.snapshot?.();
    if (!status?.connected) throw new Error('LiberLive 琴尚未连接');
    if (!currentPayload?.bytes?.length) {
      const result = await window.FreezaCurrentSongDevicePayload?.();
      currentPayload = result?.bytes?.length ? result : null;
    }
    if (!currentPayload) throw new Error('当前歌曲没有原琴载荷');
    const key = songKey(currentPayload);
    if (key && stagedSongKey === key && status.streamStaged) return { staged: true, cached: true };
    if (preparePromise) {
      if (preparePromiseKey === key) return preparePromise;
      try { await preparePromise; } catch { /* a replaced song cancels the previous stream */ }
      status = window.FreezaLiberLive?.snapshot?.();
      if (!status?.connected) throw new Error('LiberLive 琴尚未连接');
    }
    preparePromiseKey = key;
    preparePromise = (async () => {
      const result = await window.FreezaLiberLive.stageDeviceSong(currentPayload.bytes, { onProgress });
      stagedSongKey = key;
      return result;
    })();
    try {
      return await preparePromise;
    } finally {
      preparePromise = null;
      preparePromiseKey = '';
    }
  }

  async function activateDeviceSongStream({ onProgress } = {}) {
    const staged = await stageDeviceSongStream({ onProgress });
    if (staged?.cancelled) return staged;
    const status = window.FreezaLiberLive?.snapshot?.();
    if (status?.streamReady) return { ready: true, cached: true };
    const result = await window.FreezaLiberLive?.activateDeviceSong?.({ onProgress });
    if (!result) throw new Error('原琴首个提示接口不可用');
    preparedSongKey = stagedSongKey;
    return result;
  }

  async function ensureDeviceSongStream(options = {}) {
    return activateDeviceSongStream(options);
  }

  async function scanFromClick() {
    const api = window.FreezaLiberLive;
    if (!api) return;
    const current = api.snapshot();
    if (current.connected) {
      openDialog();
      return;
    }
    window.playLaunchUiSound?.('select');
    if (current.native) openDialog();
    const result = await api.scan();
    if (result.native && !result.connected) openDialog();
  }

  function init() {
    if (!window.FreezaLiberLive || !button()) return;
    window.FreezaLiberLive.subscribe(render);
    button().addEventListener('click', scanFromClick);
    $('liberLiveScanBtn')?.addEventListener('click', scanFromClick);
    $('liberLiveDisconnectBtn')?.addEventListener('click', async () => {
      await window.FreezaLiberLive.disconnect();
      closeDialog();
    });
    window.addEventListener('freeza-song-loaded', () => {
      preparedSongKey = '';
      stagedSongKey = '';
      currentPayload = null;
      window.FreezaLiberLive?.stopDeviceSong?.();
    });
    document.querySelectorAll('[data-close-liberlive]').forEach(node => node.addEventListener('click', closeDialog));
  }

  window.FreezaLiberLiveUI = Object.freeze({
    ensureDeviceSongStream,
    stageDeviceSongStream,
    activateDeviceSongStream,
    ensureCurrentSongOnInstrument: ensureDeviceSongStream,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

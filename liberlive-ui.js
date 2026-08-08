(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const dialog = () => $('liberLiveDeviceDialog');
  const button = () => $('liberLiveConnectBtn');
  const statusLabel = () => $('liberLiveStartStatus');
  let transferGeneration = 0;
  let currentPayload = null;
  let lastConnected = false;
  let sentPayloadKey = '';
  let sendPromise = null;

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
    if (status.connected) label.textContent = '原琴发声 · App 静音 · 手动模式';
    else if (status.connecting) label.textContent = '正在建立控制连接…';
    else if (status.scanning) label.textContent = '正在扫描原版琴…';
    else if (status.error) label.textContent = status.error;
    else if (!status.supported) label.textContent = '请使用 Freeza Live App';
    else label.textContent = '点击扫描 C1 / C2 / U1';
    const transfer = $('liberLiveSongTransfer');
    const disconnect = $('liberLiveDisconnectBtn');
    const scanButton = $('liberLiveScanBtn');
    if (transfer) transfer.hidden = !status.connected;
    if (disconnect) disconnect.hidden = !status.connected;
    if (scanButton) scanButton.hidden = status.connected;
    const justConnected = status.connected && !lastConnected;
    lastConnected = status.connected;
    if (justConnected) refreshTransfer(status);
    else if (!status.connected) {
      transferGeneration += 1;
      currentPayload = null;
      sentPayloadKey = '';
    }
    renderDevices(status);
  }

  async function refreshTransfer(status = window.FreezaLiberLive?.snapshot()) {
    if (!status?.connected) return;
    const generation = ++transferGeneration;
    const title = $('liberLiveSongTransferTitle');
    const detail = $('liberLiveSongTransferStatus');
    const send = $('liberLiveSendSongBtn');
    if (send) send.disabled = true;
    if (detail) detail.textContent = '正在读取当前加密曲谱…';
    try {
      const result = await window.FreezaCurrentSongDevicePayload?.();
      if (generation !== transferGeneration) return;
      currentPayload = result?.bytes?.length ? result : null;
      if (title) title.textContent = result?.title ? `《${result.title}》` : '发送当前曲谱';
      if (detail) detail.textContent = currentPayload
        ? `已包含原琴载荷 · ${Math.round(currentPayload.bytes.length / 1024)} KB`
        : '该曲暂无原琴载荷，请选择由原版多维曲谱导入的歌曲';
      if (send) send.disabled = !currentPayload || status.uploading;
    } catch (error) {
      if (generation !== transferGeneration) return;
      currentPayload = null;
      if (detail) detail.textContent = error?.message || '无法读取原琴载荷';
    }
  }

  function payloadKey(payload) {
    if (!payload?.bytes?.length) return '';
    return `${payload.title || ''}:${payload.bytes.length}`;
  }

  async function ensureCurrentSongOnInstrument({ onProgress } = {}) {
    const status = window.FreezaLiberLive?.snapshot?.();
    if (!status?.connected) throw new Error('LiberLive 琴尚未连接');
    if (sendPromise) return sendPromise;
    sendPromise = (async () => {
      if (!currentPayload?.bytes?.length) {
        const result = await window.FreezaCurrentSongDevicePayload?.();
        currentPayload = result?.bytes?.length ? result : null;
      }
      if (!currentPayload) throw new Error('当前歌曲没有原琴载荷，不能由原琴演奏');
      const key = payloadKey(currentPayload);
      if (key && sentPayloadKey === key) return { frames: 0, cached: true };
      const result = await window.FreezaLiberLive.sendDevicePayload(currentPayload.bytes, { onProgress });
      sentPayloadKey = key;
      return result;
    })();
    try {
      return await sendPromise;
    } finally {
      sendPromise = null;
    }
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
    $('liberLiveSendSongBtn')?.addEventListener('click', async () => {
      if (!currentPayload) return;
      const send = $('liberLiveSendSongBtn');
      const detail = $('liberLiveSongTransferStatus');
      const progress = $('liberLiveSongTransferProgress');
      send.disabled = true;
      if (progress) progress.value = 0;
      try {
        const result = await ensureCurrentSongOnInstrument({
          onProgress(value, current, total) {
            if (progress) progress.value = Math.round(value * 100);
            if (detail) detail.textContent = `正在发送 ${current} / ${total}`;
          },
        });
        if (detail) detail.textContent = `发送完成 · ${result.frames} 帧`;
      } catch (error) {
        if (detail) detail.textContent = error?.message || '发送失败，请重试';
      } finally {
        send.disabled = !currentPayload;
      }
    });
    window.addEventListener('freeza-song-loaded', () => refreshTransfer());
    document.querySelectorAll('[data-close-liberlive]').forEach(node => node.addEventListener('click', closeDialog));
  }

  window.FreezaLiberLiveUI = Object.freeze({
    ensureCurrentSongOnInstrument,
    refreshTransfer,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

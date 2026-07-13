(function attachAudioOutputSafety(global) {
  'use strict';

  const HEADPHONE_PATTERN = /headphone|headset|earphone|earbud|airpods?|\bbuds?\b|beats|耳机|耳麦|耳塞/i;
  const SPEAKER_PATTERN = /speaker|loudspeaker|built[- ]?in output|iphone|ipad|手机|扬声器|扩音器|内建输出|内置输出/i;

  function classifyLabel(label = '') {
    const value = String(label).trim();
    if (!value || /^(default|communications?)$/i.test(value)) return 'unknown';
    if (HEADPHONE_PATTERN.test(value)) return 'headphones';
    if (SPEAKER_PATTERN.test(value)) return 'speaker';
    return 'unknown';
  }

  async function requestVerifiedOutput(mediaDevices, audioContext) {
    if (typeof mediaDevices?.selectAudioOutput !== 'function' || typeof audioContext?.setSinkId !== 'function') {
      return { status: 'unknown', reason: 'unsupported', deviceId: '', label: '' };
    }
    let device;
    try {
      device = await mediaDevices.selectAudioOutput();
    } catch (error) {
      return {
        status: 'unknown',
        reason: error?.name === 'NotAllowedError' ? 'cancelled' : 'selection-failed',
        deviceId: '',
        label: '',
      };
    }
    const label = String(device?.label || '');
    const deviceId = String(device?.deviceId || '');
    const status = classifyLabel(label);
    if (status === 'headphones' && deviceId) {
      try {
        await audioContext.setSinkId(deviceId);
      } catch {
        return { status: 'unknown', reason: 'routing-failed', deviceId: '', label };
      }
    }
    return { status, reason: 'selected', deviceId, label };
  }

  async function verifyHeadphoneStillAvailable(mediaDevices, deviceId, label = '') {
    if (!deviceId || classifyLabel(label) !== 'headphones' || typeof mediaDevices?.enumerateDevices !== 'function') {
      return false;
    }
    try {
      const devices = await mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'audiooutput'
        && device.deviceId === deviceId
        && classifyLabel(device.label || label) === 'headphones');
    } catch {
      return false;
    }
  }

  global.FreezaAudioOutputSafety = Object.freeze({
    classifyLabel,
    requestVerifiedOutput,
    verifyHeadphoneStillAvailable,
  });
})(typeof window === 'undefined' ? globalThis : window);

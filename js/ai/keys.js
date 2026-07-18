// API key storage (localStorage only) and the settings dialog.
import { $ } from '../util.js';

const LS_KEY = 'photoslop.settings.v1';

export function getSettings() {
  try {
    return { openaiKey: '', geminiKey: '', mock: false, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
  } catch {
    return { openaiKey: '', geminiKey: '', mock: false };
  }
}

export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(LS_KEY, JSON.stringify(s));
  return s;
}

export function initKeysDialog() {
  const dlg = $('#dlg-keys');
  const openaiIn = $('#key-openai'), geminiIn = $('#key-gemini'), mockChk = $('#opt-mock');
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    saveSettings({
      openaiKey: openaiIn.value.trim(),
      geminiKey: geminiIn.value.trim(),
      mock: mockChk.checked,
    });
  });
  return function open() {
    const s = getSettings();
    openaiIn.value = s.openaiKey;
    geminiIn.value = s.geminiKey;
    mockChk.checked = s.mock;
    dlg.showModal();
  };
}

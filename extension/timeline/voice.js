/**
 * Timeline voice dictation — MediaRecorder + SaluteSpeech API.
 * Handles mic recording, WebM→WAV conversion, speech recognition.
 */
import { toast } from "./ui.js";

/* ── State ── */
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let isRecording = false;
let recordTimer = null;
let recordSeconds = 0;

const SBER_TOKEN_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const SBER_RECOGNIZE_URL = "https://smartspeech.sber.ru/rest/v1/speech:recognize";

/* ── SVG icons (stroke-based, inherit color via currentColor) ── */
const MIC_IDLE_SVG = '<svg class="mic-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="1" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const MIC_REC_SVG = '<svg class="mic-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const MIC_WAIT_SVG = '<svg class="mic-icon mic-wait" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

function setMicIcon(svg, timerText) {
  const btn = document.getElementById("btnMic");
  btn.innerHTML = svg + (timerText ? `<span class="mic-timer">${timerText}</span>` : "");
}

/* ── Public API ── */

export function initVoiceInput() {
  const btn = document.getElementById("btnMic");
  const btnSettings = document.getElementById("btnMicSettings");
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    btn.classList.add("hidden");
    if (btnSettings) btnSettings.classList.add("hidden");
    return;
  }
  btn.addEventListener("click", () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
  if (btnSettings) {
    btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      promptSberCredentials();
    });
  }
}

export function cleanupRecording() {
  stopRecording();
}

/** Toggle recording from outside (e.g. keyboard shortcut) */
export function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

export { isRecording };

/* ── Sber credentials ── */

async function getSberAuthKey() {
  const d = await chrome.storage.local.get(["sberAuthKey"]);
  return d.sberAuthKey || "";
}

async function promptSberCredentials() {
  const key = await getSberAuthKey();
  const authKey = prompt(
    "Authorization Key ( studio.sber.ru → Настройки API → Получить ключ ):",
    key || ""
  );
  if (authKey === null) return;
  if (!authKey.trim()) {
    await chrome.storage.local.remove(["sberAuthKey"]);
    toast("Данные Сбера удалены", "ok");
    return;
  }
  await chrome.storage.local.set({ sberAuthKey: authKey.trim() });
  toast("Authorization Key сохранён", "ok");
}

/* ── Sber OAuth ── */

async function getSberAccessToken(authKey) {
  const resp = await fetch(SBER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Authorization": `Basic ${authKey}`,
      "RqUID": crypto.randomUUID(),
    },
    body: "scope=SALUTE_SPEECH_PERS",
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.warn("[prjcap voice] token response:", resp.status, errText);
    throw new Error(`Token request failed: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  return data.access_token;
}

/* ── Audio conversion ── */

function webmToWavBlob(webmBlob) {
  return new Promise((resolve) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const reader = new FileReader();
    reader.onload = async () => {
      const audioBuffer = await audioCtx.decodeAudioData(reader.result);
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const renderedBuffer = await offlineCtx.startRendering();
      const pcm = renderedBuffer.getChannelData(0);
      const wavBuf = new ArrayBuffer(44 + pcm.length * 2);
      const view = new DataView(wavBuf);
      const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + pcm.length * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      resolve(new Blob([wavBuf], { type: "audio/wav" }));
    };
    reader.readAsArrayBuffer(webmBlob);
  });
}

/* ── Recording ── */

async function startRecording() {
  const authKey = await getSberAuthKey();
  if (!authKey) {
    toast("Нужен Authorization Key Сбера. Нажмите ⚙️ рядом с микрофоном.", "err");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast("Не удалось получить доступ к микрофону", "err");
    return;
  }

  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  mediaRecorder = new MediaRecorder(micStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    clearInterval(recordTimer);
    if (audioChunks.length === 0) { toast("Аудио не записано", "err"); return; }
    const rawBlob = new Blob(audioChunks, { type: mimeType });
    await transcribeWithSber(rawBlob);
  };

  mediaRecorder.start(250);
  isRecording = true;
  recordSeconds = 0;
  document.getElementById("btnMic").classList.add("recording");
  setMicIcon(MIC_REC_SVG);

  recordTimer = setInterval(() => {
    recordSeconds++;
    const m = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
    const s = String(recordSeconds % 60).padStart(2, "0");
    setMicIcon(MIC_REC_SVG, `${m}:${s}`);
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  isRecording = false;
  document.getElementById("btnMic").classList.remove("recording");
  setMicIcon(MIC_IDLE_SVG);
  clearInterval(recordTimer);
}

/* ── Speech recognition ── */

async function transcribeWithSber(audioBlob) {
  const authKey = await getSberAuthKey();
  if (!authKey) { toast("Authorization Key Сбера не настроен", "err"); return; }

  setMicIcon(MIC_WAIT_SVG);
  toast("Подготавливаю аудио…", "ok");

  try {
    const wavBlob = await webmToWavBlob(audioBlob);
    if (wavBlob.size > 2 * 1024 * 1024) {
      toast("Аудио слишком длинное (макс 1 минута)", "err");
      setMicIcon(MIC_IDLE_SVG);
      return;
    }

    toast("Распознаю речь…", "ok");

    let accessToken;
    try {
      accessToken = await getSberAccessToken(authKey);
    } catch (err) {
      toast("Ошибка авторизации Сбера. Проверьте Authorization Key.", "err");
      setMicIcon(MIC_IDLE_SVG);
      return;
    }

    const resp = await fetch(`${SBER_RECOGNIZE_URL}?language=ru-RU&sample_rate=16000`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "audio/x-pcm;bit=16;rate=16000",
      },
      body: wavBlob,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 401) toast("Токен отклонён. Проверьте данные Сбера (⚙️).", "err");
      else toast(`Ошибка распознавания: ${resp.status}`, "err");
      setMicIcon(MIC_IDLE_SVG);
      return;
    }

    const data = await resp.json();
    const text = (data.result || []).join(" ");
    if (text.trim()) {
      const ta = document.getElementById("mText");
      const base = ta.value.trim();
      ta.value = base ? `${base} ${text.trim()}` : text.trim();
      ta.scrollTop = ta.scrollHeight;
      toast("Голос распознан", "ok");
    } else {
      toast("Речь не распознана. Попробуйте ещё раз.", "err");
    }
  } catch (err) {
    toast("Ошибка при распознавании: " + err.message, "err");
  } finally {
    setMicIcon(MIC_IDLE_SVG);
  }
}

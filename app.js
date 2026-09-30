const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone'), input = $('fileInput'), filePanel = $('filePanel'), convertBtn = $('convertBtn');
let file = null, downloadUrl = null;

// ffmpeg.wasm helper
const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: false });
let ffmpegLoaded = false;
async function ensureFFmpeg(progressLabel) {
  if (ffmpegLoaded) return;
  if (progressLabel) progress(progressLabel, 3);
  await ffmpeg.load();
  ffmpegLoaded = true;
}

// UI events
dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
input.addEventListener('change', e => e.target.files[0] && setFile(e.target.files[0]));
['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave','drop'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => e.dataTransfer.files[0] && setFile(e.dataTransfer.files[0]));
$('removeBtn').addEventListener('click', clearFile);
convertBtn.addEventListener('click', convert);

function setFile(selected) {
  if (selected.size > 2 * 1024 * 1024 * 1024) return showError('文件超过 2 GB，暂不支持处理。');
  file = selected;
  $('fileName').textContent = selected.name;
  $('fileMeta').textContent = `${formatBytes(selected.size)}  ·  ${selected.type || '媒体文件'}`;
  dropzone.classList.add('hidden'); filePanel.classList.remove('hidden'); convertBtn.disabled = false;
  $('result').classList.add('hidden'); $('error').classList.add('hidden');
}
function clearFile() { file = null; input.value = ''; dropzone.classList.remove('hidden'); filePanel.classList.add('hidden'); convertBtn.disabled = true; $('result').classList.add('hidden'); }
function formatBytes(n) { if (!n) return '0 B'; const units=['B','KB','MB','GB']; const i=Math.floor(Math.log(n)/Math.log(1024)); return `${(n/1024**i).toFixed(i ? 1 : 0)} ${units[i]}`; }
function showError(msg) { $('error').textContent = msg; $('error').classList.remove('hidden'); }
function progress(label, value) { $('progressArea').classList.remove('hidden'); $('progressLabel').textContent=label; $('progressValue').textContent=`${Math.round(value)}%`; $('progressBar').style.width=`${value}%`; }

function isMidiFile(f) {
  const name = (f && f.name || '').toLowerCase();
  const type = f && f.type || '';
  return type.includes('midi') || type.includes('mid') || name.endsWith('.mid') || name.endsWith('.midi');
}

async function convert() {
  if (!file) return;
  convertBtn.disabled = true; $('result').classList.add('hidden'); $('error').classList.add('hidden');
  try {
    progress('正在读取文件…', 8);
    const buffer = await file.arrayBuffer();

    const quality = $('quality').value;
    const rate = quality === 'small' ? 22050 : quality === 'standard' ? 44100 : 48000;
    const format = $('format').value;

    let audioBuffer = null;

    if (isMidiFile(file)) {
      progress('正在解析 MIDI 并合成音频…', 20);
      audioBuffer = await renderMidiToAudioBuffer(buffer, rate);
    } else {
      progress('正在解码音频/视频…', 25);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('当前浏览器不支持 Web Audio API，请更新浏览器。');
      const sourceCtx = new AudioCtx();
      audioBuffer = await sourceCtx.decodeAudioData(buffer.slice(0));
      await sourceCtx.close();
      if (audioBuffer.sampleRate !== rate) {
        progress('正在重采样音频…', 50);
        audioBuffer = await renderAtRate(audioBuffer, rate);
      }
    }

    progress('正在生成 WAV（中间格式）…', 65);
    const wavBlob = encodeWav(audioBuffer);

    // If output is WAV and not asking for extra encoding
    if (format === 'wav') {
      finishWithBlob(wavBlob, 'wav');
      return;
    }

    // Use ffmpeg.wasm to encode to MP3 or FLAC, or fall back to MediaRecorder for webm/ogg
    if (format === 'mp3' || format === 'flac') {
      progress('正在加载编解码器（这可能需要几秒）…', 70);
      await ensureFFmpeg('正在加载编解码器…');
      // write input
      ffmpeg.FS('writeFile', 'input.wav', await fetchFile(wavBlob));
      progress(`正在转换为 ${format.toUpperCase()}…`, 80);
      if (format === 'mp3') {
        // -q:a 2 => VBR quality
        await ffmpeg.run('-i', 'input.wav', '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', 'output.mp3');
        const data = ffmpeg.FS('readFile', 'output.mp3');
        const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
        finishWithBlob(blob, 'mp3');
        // cleanup
        ffmpeg.FS('unlink', 'output.mp3'); ffmpeg.FS('unlink', 'input.wav');
        return;
      } else {
        // flac
        await ffmpeg.run('-i', 'input.wav', '-vn', '-compression_level', '5', 'output.flac');
        const data = ffmpeg.FS('readFile', 'output.flac');
        const blob = new Blob([data.buffer], { type: 'audio/flac' });
        finishWithBlob(blob, 'flac');
        ffmpeg.FS('unlink', 'output.flac'); ffmpeg.FS('unlink', 'input.wav');
        return;
      }
    }

    // webm/ogg fallback using MediaRecorder
    if (format === 'webm' || format === 'ogg') {
      progress('正在使用浏览器编码（可能受限）…', 75);
      const blob = await recordCompressed(audioBuffer, format);
      finishWithBlob(blob, format === 'ogg' ? 'ogg' : 'webm');
      return;
    }

    throw new Error('不支持的输出格式');

  } catch (err) {
    console.error(err);
    showError(`转换失败：${err.message || '无法读取此文件，请尝试其他格式。'}`);
    $('progressArea').classList.add('hidden');
  }
  convertBtn.disabled = false;
}

function finishWithBlob(blob, extension) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(blob);
  const base = file.name.replace(/\.[^/.]+$/, '') || 'converted-audio';
  $('downloadBtn').href = downloadUrl; $('downloadBtn').download = `${base}.${extension}`;
  $('resultMeta').textContent = `${formatBytes(blob.size)}  ·  ${extension.toUpperCase()} 文件`;
  $('result').classList.remove('hidden'); progress('转换完成', 100);
  convertBtn.disabled = false;
}

async function renderAtRate(audio, rate) {
  if (audio.sampleRate === rate) return audio;
  const length = Math.ceil(audio.duration * rate);
  const ctx = new OfflineAudioContext(audio.numberOfChannels, length, rate);
  const src = ctx.createBufferSource(); src.buffer = audio; src.connect(ctx.destination); src.start();
  return ctx.startRendering();
}

// Simple WAV encoder (interleaves channels into 16-bit PCM)
function encodeWav(audio) {
  const channels = audio.numberOfChannels;
  const sampleRate = audio.sampleRate;
  const length = audio.length;
  const bytes = length * channels * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  writeStr(view, 0, 'RIFF'); view.setUint32(4, 36 + bytes, true); writeStr(view, 8, 'WAVE'); writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  writeStr(view, 36, 'data'); view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      let s = Math.max(-1, Math.min(1, audio.getChannelData(c)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
function writeStr(view, offset, string) { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); }

// Record compressed formats via MediaRecorder (used for webm/ogg fallback)
async function recordCompressed(audio, format) {
  const mime = format === 'ogg' ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mime)) throw new Error(`${format.toUpperCase()} 编码不是当前浏览器支持的格式，请改选 WAV/MP3/FLAC。`);
  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), src = ctx.createBufferSource();
  src.buffer = audio; src.connect(dest); const chunks = [];
  const recorder = new MediaRecorder(dest.stream, { mimeType: mime }); recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(resolve => recorder.onstop = resolve);
  recorder.start(); src.start(); await new Promise(resolve => src.onended = resolve); recorder.stop(); await done; await ctx.close();
  return new Blob(chunks, { type: mime });
}

// MIDI rendering: parse with @tonejs/midi then synthesize with simple oscillators on OfflineAudioContext
async function renderMidiToAudioBuffer(arrayBuffer, rate) {
  // Midi is provided by the global Midi from @tonejs/midi (loaded in index.html)
  const midi = new Midi(arrayBuffer);
  const duration = midi.duration || 1;
  const numChannels = 2;
  const length = Math.ceil(duration * rate);
  const ctx = new OfflineAudioContext(numChannels, length, rate);

  // Simple polyphonic synth per note: oscillator + ADSR envelope
  midi.tracks.forEach(track => {
    track.notes.forEach(note => {
      const start = note.time; // seconds
      const dur = Math.max(0.02, note.duration);
      const osc = ctx.createOscillator();
      // choose waveform based on velocity or track index (simple variation)
      osc.type = 'sine';
      osc.frequency.value = midiNoteToFrequency(note.midi);
      const gain = ctx.createGain();
      // ADSR
      const attack = 0.005;
      const release = 0.02;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime((note.velocity || 0.8) * 0.9, start + attack);
      gain.gain.setValueAtTime((note.velocity || 0.8) * 0.9, start + dur - release);
      gain.gain.linearRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    });
  });

  const rendered = await ctx.startRendering();
  return rendered;
}
function midiNoteToFrequency(note) { return 440 * Math.pow(2, (note - 69) / 12); }


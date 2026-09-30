/* 升级版脚本：支持队列、批量处理、预设、下载历史（localStorage） */
const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone'), input = $('fileInput'), queueList = $('queueList'), queueWrap = $('queue'), convertAllBtn = $('convertAllBtn'), addFilesBtn = $('addFilesBtn'), clearQueueBtn = $('clearQueueBtn'), presetSelect = $('presetSelect'), progressArea = $('progressArea'), historyList = $('historyList'), clearHistoryBtn = $('clearHistory'), errorEl = $('error');
let queue = []; let processing = false; let ffmpegLoaded = false; let downloadUrlPool = [];

// ffmpeg.wasm
const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: false });
async function ensureFFmpeg() { if (ffmpegLoaded) return; await ffmpeg.load(); ffmpegLoaded = true; }

// load history from localStorage
const HISTORY_KEY = 'sonora_history_v1';
function loadHistory() { try { const raw = localStorage.getItem(HISTORY_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); }
function addHistory(entry) { const h = loadHistory(); h.unshift(entry); saveHistory(h); renderHistory(); }
function renderHistory() { const h = loadHistory(); historyList.innerHTML = ''; h.slice(0,50).forEach(item => { const li = document.createElement('li'); li.className='history-item'; li.innerHTML = `<div>${item.name}</div><div class="item-sub">${item.format.toUpperCase()} · ${item.size}</div><a href="${item.url}" download="${item.name}">下载</a>`; historyList.appendChild(li); }); }

renderHistory();

// UI events
dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
input.addEventListener('change', e => { const files = Array.from(e.target.files || []); if (files.length) addFilesToQueue(files); input.value=''; });
addFilesBtn.addEventListener('click', () => input.click());
['dragenter','dragover'].forEach(t => dropzone.addEventListener(t, e => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave','drop'].forEach(t => dropzone.addEventListener(t, e => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', e => { const files = Array.from(e.dataTransfer.files || []); if (files.length) addFilesToQueue(files); });
convertAllBtn.addEventListener('click', () => { if (!queue.length) return; startProcessing(); });
clearQueueBtn.addEventListener('click', () => { queue = []; renderQueue(); });
clearHistoryBtn.addEventListener('click', () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });

function showError(msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); setTimeout(()=>errorEl.classList.add('hidden'), 8000); }
function progress(label, value) { progressArea.classList.remove('hidden'); $('progressLabel').textContent = label; $('progressValue').textContent = `${Math.round(value)}%`; $('progressBar').style.width = `${value}%`; }

function addFilesToQueue(files) {
  files.forEach(f => {
    if (f.size > 2 * 1024 * 1024 * 1024) { showError(`跳过 ${f.name}：文件超过 2 GB`); return; }
    const id = cryptoRandomId();
    const preset = presetSelect.value;
    const { format, quality } = presetToOptions(preset);
    queue.push({ id, file: f, status: 'queued', format, quality, output: null, error: null });
  });
  renderQueue();
}

function presetToOptions(p) {
  switch(p) {
    case 'high_mp3': return { format: 'mp3', quality: 'high' };
    case 'std_mp3': return { format: 'mp3', quality: 'standard' };
    case 'wav_lossless': return { format: 'wav', quality: 'high' };
    case 'flac': return { format: 'flac', quality: 'high' };
    case 'small_ogg': return { format: 'ogg', quality: 'small' };
    default: return { format: 'wav', quality: 'standard' };
  }
}

function renderQueue() {
  queueWrap.classList.toggle('hidden', queue.length === 0);
  queueList.innerHTML = '';
  queue.forEach(item => {
    const li = document.createElement('li'); li.className = 'queue-item';
    const title = `<div class="item-meta"><div class="item-title">${escapeHtml(item.file.name)}</div><div class="item-sub">${formatBytes(item.file.size)} · ${item.format.toUpperCase()} · ${item.quality}</div></div>`;
    const actions = document.createElement('div'); actions.className='item-actions';
    const convertBtn = document.createElement('button'); convertBtn.textContent='转换'; convertBtn.className='icon-button'; convertBtn.disabled = item.status==='processing' || item.status==='done'; convertBtn.addEventListener('click',()=>startProcessing(item.id));
    const removeBtn = document.createElement('button'); removeBtn.textContent='移除'; removeBtn.className='icon-button'; removeBtn.addEventListener('click',()=>{ queue = queue.filter(q=>q.id!==item.id); renderQueue(); });
    const status = document.createElement('div'); status.textContent = statusText(item.status); status.className='item-sub';
    actions.appendChild(convertBtn); actions.appendChild(removeBtn);
    li.innerHTML = title; li.appendChild(status); li.appendChild(actions);
    queueList.appendChild(li);
  });
  convertAllBtn.disabled = queue.length === 0;
}

function statusText(s) { switch(s){ case 'queued': return '排队中'; case 'processing': return '处理中'; case 'done': return '已完成'; case 'error': return '出错'; default: return s; } }

async function startProcessing(singleId=null) {
  if (processing) return; processing = true; errorEl.classList.add('hidden');
  try {
    // process a single item if id provided, otherwise process all queued
    const toProcess = singleId ? queue.filter(q=>q.id===singleId) : queue.filter(q=>q.status==='queued');
    for (const item of toProcess) {
      // mark processing
      item.status = 'processing'; renderQueue();
      try {
        progress(`读取 ${item.file.name}`, 5);
        const buffer = await item.file.arrayBuffer();
        const rate = item.quality === 'small' ? 22050 : item.quality === 'standard' ? 44100 : 48000;
        let audioBuffer = null;
        if (isMidi(item.file)) {
          progress('解析并合成 MIDI...', 20);
          audioBuffer = await renderMidiToAudioBuffer(buffer, rate);
        } else {
          progress('解码音频/视频...', 20);
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) throw new Error('浏览器不支持 Web Audio API');
          const srcCtx = new AudioCtx();
          audioBuffer = await srcCtx.decodeAudioData(buffer.slice(0));
          await srcCtx.close();
          if (audioBuffer.sampleRate !== rate) {
            progress('重采样中...', 40);
            audioBuffer = await renderAtRate(audioBuffer, rate);
          }
        }
        progress('生成 WAV（中间）...', 60);
        const wavBlob = encodeWav(audioBuffer);
        let outBlob = null; let ext = 'wav';
        if (item.format === 'wav') { outBlob = wavBlob; ext = 'wav'; }
        else if (item.format === 'mp3' || item.format === 'flac') {
          progress('加载编码器（可能耗时）...', 70);
          await ensureFFmpeg();
          ffmpeg.FS('writeFile', 'input.wav', await fetchFile(wavBlob));
          progress(`使用 ffmpeg 转码为 ${item.format.toUpperCase()}...`, 80);
          if (item.format === 'mp3') {
            await ffmpeg.run('-i','input.wav','-vn','-codec:a','libmp3lame','-q:a','2','output.mp3');
            const data = ffmpeg.FS('readFile','output.mp3'); outBlob = new Blob([data.buffer],{type:'audio/mpeg'}); ext='mp3';
            ffmpeg.FS('unlink','output.mp3'); ffmpeg.FS('unlink','input.wav');
          } else {
            await ffmpeg.run('-i','input.wav','-vn','-compression_level','5','output.flac');
            const data = ffmpeg.FS('readFile','output.flac'); outBlob = new Blob([data.buffer],{type:'audio/flac'}); ext='flac';
            ffmpeg.FS('unlink','output.flac'); ffmpeg.FS('unlink','input.wav');
          }
        } else if (item.format === 'ogg' || item.format === 'webm') {
          outBlob = await recordCompressed(audioBuffer, item.format);
          ext = item.format === 'ogg' ? 'ogg' : 'webm';
        } else {
          throw new Error('不支持的输出格式');
        }
        // done
        const url = URL.createObjectURL(outBlob); downloadUrlPool.push(url);
        item.status='done'; item.output={blob:outBlob,url,ext}; renderQueue();
        addHistory({ name: `${item.file.name.replace(/\.[^/.]+$/,'')}.${ext}`, format: ext, size: formatBytes(outBlob.size), url });
      } catch (err) {
        console.error(err); item.status='error'; item.error=err.message || String(err); renderQueue(); showError(`文件 ${item.file.name} 转换失败：${err.message||err}`);
      }
    }
    progress('全部任务完成', 100);
  } finally { processing=false; }
}

// utilities and media helpers (from previous version)
function isMidi(f) { const name=(f&&f.name||'').toLowerCase(); const type=(f&&f.type||''); return type.includes('midi')||name.endsWith('.mid')||name.endsWith('.midi'); }
async function renderAtRate(audio, rate){ if (audio.sampleRate===rate) return audio; const len=Math.ceil(audio.duration*rate); const ctx=new OfflineAudioContext(audio.numberOfChannels,len,rate); const src=ctx.createBufferSource(); src.buffer=audio; src.connect(ctx.destination); src.start(); return ctx.startRendering(); }
function encodeWav(audio){ const channels=audio.numberOfChannels,sampleRate=audio.sampleRate,length=audio.length,bytes=length*channels*2,out=new ArrayBuffer(44+bytes),view=new DataView(out); writeStr(view,0,'RIFF'); view.setUint32(4,36+bytes,true); writeStr(view,8,'WAVE'); writeStr(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); writeStr(view,36,'data'); view.setUint32(40,bytes,true); let offset=44; for(let i=0;i<length;i++){ for(let c=0;c<channels;c++){ let s=Math.max(-1,Math.min(1,audio.getChannelData(c)[i])); view.setInt16(offset,s<0?s*0x8000:s*0x7fff,true); offset+=2; } } return new Blob([out],{type:'audio/wav'}); }
function writeStr(view,offset,str){ for(let i=0;i<str.length;i++) view.setUint8(offset+i,str.charCodeAt(i)); }
async function recordCompressed(audio, format){ const mime = format==='ogg' ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus'; if(!MediaRecorder.isTypeSupported(mime)) throw new Error(`${format.toUpperCase()} 未被当前浏览器支持`); const ctx=new AudioContext(), dest=ctx.createMediaStreamDestination(), src=ctx.createBufferSource(); src.buffer=audio; src.connect(dest); const chunks=[]; const recorder=new MediaRecorder(dest.stream,{mimeType:mime}); recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data); const done=new Promise(res=>recorder.onstop=res); recorder.start(); src.start(); await new Promise(res=>src.onended=res); recorder.stop(); await done; await ctx.close(); return new Blob(chunks,{type:mime}); }

// MIDI rendering using @tonejs/midi
async function renderMidiToAudioBuffer(arrayBuffer, rate){ const midi = new Midi(arrayBuffer); const duration = midi.duration || 1; const numChannels=2; const length=Math.ceil(duration*rate); const ctx=new OfflineAudioContext(numChannels,length,rate); midi.tracks.forEach(track=>{ track.notes.forEach(note=>{ const start=note.time; const dur=Math.max(0.02,note.duration); const osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value=midiNoteToFrequency(note.midi); const gain=ctx.createGain(); const attack=0.005; const release=0.02; gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime((note.velocity||0.8)*0.9,start+attack); gain.gain.setValueAtTime((note.velocity||0.8)*0.9,start+dur-release); gain.gain.linearRampToValueAtTime(0.0001,start+dur); osc.connect(gain); gain.connect(ctx.destination); osc.start(start); osc.stop(start+dur+0.05); }); }); const rendered = await ctx.startRendering(); return rendered; }
function midiNoteToFrequency(n){ return 440*Math.pow(2,(n-69)/12); }

// small helpers
function formatBytes(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(n)/Math.log(1024)); return `${(n/1024**i).toFixed(i?1:0)} ${u[i]}`; }
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function cryptoRandomId(){ return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=> (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16)); }


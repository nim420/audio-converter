const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone'), input = $('fileInput'), filePanel = $('filePanel'), convertBtn = $('convertBtn');
let file = null, downloadUrl = null;

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

async function convert() {
  if (!file) return;
  convertBtn.disabled = true; $('result').classList.add('hidden'); $('error').classList.add('hidden');
  try {
    progress('正在读取文件…', 10);
    const buffer = await file.arrayBuffer(); progress('正在解码音频…', 35);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('当前浏览器不支持 Web Audio API，请更新浏览器。');
    const sourceCtx = new AudioCtx();
    const audio = await sourceCtx.decodeAudioData(buffer.slice(0));
    await sourceCtx.close(); progress('正在生成音频…', 70);
    const quality = $('quality').value;
    const rate = quality === 'small' ? 22050 : quality === 'standard' ? 44100 : 48000;
    const rendered = await renderAtRate(audio, rate);
    const format = $('format').value;
    let blob, extension, mime;
    if (format === 'wav') { blob = encodeWav(rendered); extension='wav'; mime='audio/wav'; }
    else { blob = await recordCompressed(rendered, format); extension = format; mime = format === 'ogg' ? 'audio/ogg' : 'audio/webm'; }
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const base = file.name.replace(/\.[^/.]+$/, '') || 'converted-audio';
    $('downloadBtn').href = downloadUrl; $('downloadBtn').download = `${base}.${extension}`;
    $('resultMeta').textContent = `${formatBytes(blob.size)}  ·  ${extension.toUpperCase()} 文件`;
    $('result').classList.remove('hidden'); progress('转换完成', 100);
  } catch (err) { showError(`转换失败：${err.message || '无法读取此文件，请尝试其他格式。'}`); $('progressArea').classList.add('hidden'); }
  convertBtn.disabled = false;
}
async function renderAtRate(audio, rate) {
  if (audio.sampleRate === rate) return audio;
  const length = Math.ceil(audio.duration * rate);
  const ctx = new OfflineAudioContext(audio.numberOfChannels, length, rate);
  const src = ctx.createBufferSource(); src.buffer=audio; src.connect(ctx.destination); src.start(); return ctx.startRendering();
}
function encodeWav(audio) {
  const channels=audio.numberOfChannels, sampleRate=audio.sampleRate, length=audio.length, bytes=length*channels*2, out=new ArrayBuffer(44+bytes), view=new DataView(out);
  write(view,0,'RIFF'); view.setUint32(4,36+bytes,true); write(view,8,'WAVE'); write(view,12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*channels*2,true); view.setUint16(32,channels*2,true); view.setUint16(34,16,true); write(view,36,'data'); view.setUint32(40,bytes,true);
  let offset=44; for(let i=0;i<length;i++) for(let c=0;c<channels;c++){let s=Math.max(-1,Math.min(1,audio.getChannelData(c)[i])); view.setInt16(offset,s<0?s*0x8000:s*0x7fff,true); offset+=2;} return new Blob([out],{type:'audio/wav'});
}
function write(view, offset, text) { for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i)); }
async function recordCompressed(audio, format) {
  const mime = format === 'ogg' ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mime)) throw new Error(`${format.toUpperCase()} 编码不是当前浏览器支持的格式，请改选 WAV。`);
  const ctx = new AudioContext(), dest=ctx.createMediaStreamDestination(), src=ctx.createBufferSource(); src.buffer=audio; src.connect(dest); const chunks=[];
  const recorder=new MediaRecorder(dest.stream,{mimeType:mime}); recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data); const done=new Promise(resolve=>recorder.onstop=resolve); recorder.start(); src.start();
  await new Promise(resolve=>src.onended=resolve); recorder.stop(); await done; await ctx.close(); return new Blob(chunks,{type:mime});
}

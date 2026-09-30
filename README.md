# sonora · 本地音频转换器

一个无需上传文件的纯前端音频转换网页。支持从 MP4、MOV、WebM、MIDI 等文件中提取或合成音频，并导出为 WAV、MP3、FLAC、WebM、OGG。

## 使用

直接打开 `index.html`，或部署到任意静态网站托管服务（GitHub Pages、Netlify、Vercel 等）。无需构建步骤、无需后端。

## 新增功能

- 支持 MIDI (.mid/.midi) 作为输入：在浏览器中合成 MIDI（基于简单振荡器合成器），再导出为音频格式。
- 新增 MP3 与 FLAC 输出：使用 FFmpeg WebAssembly 在浏览器端转换 WAV（中间格式）为 MP3 / FLAC。

## 隐私与技术说明

- 文件通过 `File.arrayBuffer()` 在本地读取，不会发起上传请求。
- MIDI 文件不是音频，我们在浏览器中解析 MIDI 事件并使用 OfflineAudioContext 合成音频（合成器为简单波形合成器，适合快速预览与导出，而非专业音色）。
- MP3/FLAC 编码使用 `@ffmpeg/ffmpeg` 的 WebAssembly 版本（会在浏览器中下载编解码器文件，请耐心等待第一次加载）。
- WAV 仍然作为中间格式生成并用于后续编码。

## 限制与建议

- ffmpeg.wasm 体积较大，首次使用 MP3/FLAC 转换时需要下载 WASM 资源，可能耗时数秒到数十秒，取决于网络。
- 合成 MIDI 使用简单波形（sine），如果你需要更真实的乐器音色，可集成 SoundFont / Sampler（这需要额外的采样文件）。
- 浏览器对源视频/音频的解码能力依赖于内置编解码器，某些格式可能无法解码。

## 代码位置

- `index.html`：界面与 CDN 依赖（@ffmpeg/ffmpeg、@tonejs/midi）
- `app.js`：转换逻辑、MIDI 合成、WAV 生成与 ffmpeg 转码
- `style.css`：样式


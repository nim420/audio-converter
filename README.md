# sonora · 本地音频转换器

一个无需上传文件的纯前端音频转换网页。支持从 MP4、MOV、WebM 等视频中提取音频，并导出为 WAV；在浏览器支持时也可导出 WebM / OGG。

## 使用

直接打开 `index.html`，或部署到任意静态网站托管服务（GitHub Pages、Netlify、Vercel 等）。无需构建步骤、无需后端。

## 隐私与技术说明

- 文件通过 `File.arrayBuffer()` 在本地读取，不会发起上传请求。
- WAV 使用 Web Audio API 解码并由 JavaScript 写入 PCM WAV 文件。
- WebM / OGG 使用浏览器原生 `MediaRecorder` 编码，实际支持情况取决于浏览器。
- MP4 能否解码取决于浏览器内置的音视频编解码器。

# LivePlayer 网页版钢琴和弦播放器

已实现：

- 漂亮的玻璃拟态界面与钢琴键盘
- 鼠标点击琴键发声
- 粘贴/输入吉他和弦谱并解析和弦
- 支持常见和弦：C、Am、Fmaj7、G7、Dsus4、C/E 等
- 和弦队列点击试听
- BPM 控制、自动播放、循环播放

## 运行

直接双击打开：

```text
web-player/index.html
```

或在项目根目录启动静态服务器：

```powershell
cd web-player
python -m http.server 5173
```

然后访问 http://localhost:5173

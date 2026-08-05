(() => {
  const STORAGE_KEY = 'freeza-live-ui-language';
  const MODES = Object.freeze(['auto', 'yue', 'zh-Hant', 'ja', 'en', 'zh-Hans']);

  const en = {
    '今晚想演奏哪一首？': 'What would you like to play?',
    '选择自由演奏，或搜索歌曲和歌手进入演奏设置。': 'Choose Free Play, or search for a song or artist.',
    '自由演奏': 'Free Play',
    '不限时间 · BPM 自由调节 · 单音与和弦伴奏': 'No time limit · Adjustable BPM · Notes and chord backing',
    '进入设置': 'Open setup', '歌手': 'Artist', '全部歌手': 'All artists', '语言': 'Language',
    '全部语言': 'All languages', '中文': 'Chinese', '日文': 'Japanese', '纯音乐': 'Instrumental',
    '版本': 'Chart', '全部版本': 'All charts', '标准版': 'Standard', '进阶版': 'Advanced',
    '排序': 'Sort', '推荐': 'Recommended', '热度': 'Popular', '歌名': 'Title',
    '没有找到歌曲': 'No songs found', '试试缩短关键词或切换筛选条件': 'Try a shorter query or different filters',
    '显示更多': 'Show more', '请选择一首歌曲': 'Choose a song', '选择筛选条件': 'Choose a filter',
    '没有匹配的选项': 'No matching options', '当前歌曲': 'Current song', '演奏方式': 'Performance',
    '模式': 'Mode', '和弦触发': 'Chord trigger', '自动': 'Auto', '全自动和弦': 'Automatic chords',
    '一键': 'One-key', '任意键演奏': 'Play with any key', '辅助': 'Assisted', '半自动和弦': 'Assisted chords',
    '手动': 'Manual', '自由触发': 'Manual trigger', '自由': 'Free', '不限时间演奏': 'Unlimited performance',
    '鼓机': 'Drums', '节奏跟随': 'Rhythm follow', '智能': 'Smart', '跟随风格': 'Follow style',
    '开启': 'On', '持续伴奏': 'Continuous backing', '关闭': 'Off', '纯净演奏': 'No drums',
    '拨片音色': 'Pick voice', '切换当前伴奏触感': 'Change accompaniment feel',
    '鼓机音色': 'Drum kit', '切换当前节奏鼓组': 'Change the active drum kit',
    '声音控制': 'Mixer', '主旋律': 'Melody', '伴奏': 'Backing', '演奏信号': 'Performance inputs',
    '旋律声部': 'Melody part', '开': 'On', '关': 'Off', '引导': 'Intro guide', '歌词前主旋律': 'Melody before lyrics',
    '麦克风': 'Microphone', '美声': 'Vocal FX', '设置': 'Settings', '素材来源': 'Media source',
    '未选择素材': 'No media selected', '摄像头': 'Camera', '视频': 'Video', '声音': 'Audio',
    '视频声音': 'Video audio', '是否加入演奏与录像': 'Include in performance and recording',
    '摄像头方向': 'Camera facing', '进入演奏前选择镜头': 'Choose a camera before playing', '前置': 'Front', '后置': 'Rear',
    '麦克风工作室': 'Vocal studio', '处理后写入录音，不连接扬声器': 'Processed into the recording without speaker output',
    '原声': 'Natural', '清亮': 'Bright', '温暖': 'Warm', '舞台': 'Stage', '大厅': 'Hall',
    '润色': 'Polish', '混响': 'Reverb', '回声': 'Echo', '延迟': 'Delay',
    'MIDI 键盘': 'MIDI keyboard', '点击连接 USB / 蓝牙': 'Connect USB / Bluetooth',
    '设置会同步到演奏画面': 'Settings carry into the performance', '进入演奏': 'Start performance',
    '正在准备演奏': 'Preparing performance', '核心谱面': 'Core chart', 'MIDI · WASM · 风格包': 'MIDI · WASM · Style pack',
    '等待': 'Waiting', '主旋律钢琴': 'Melody piano', '动态采样音色': 'Dynamic sampled instrument',
    '拨片 A': 'Pick A', '本曲所需音色与采样': 'Required instruments and samples', '拨片 B': 'Pick B',
    '歌曲所需 A/B 鼓组': 'Required A/B drum kits', '录音输入': 'Recording input', '准备载入…': 'Preparing…',
    '请先佩戴耳机': 'Please wear headphones',
    '确认佩戴耳机后，将立即打开人声回放，方便试听美声、混响、回声和延迟效果。': 'After confirming headphones, live vocal monitoring will start for checking effects.',
    '扬声器外放可能产生啸叫；系统会在检测到持续自激时自动关闭回放。': 'Speaker playback may feed back; monitoring will stop automatically if feedback is detected.',
    '暂不回放': 'Not now', '已戴耳机，开始回放': 'Headphones on — monitor',
    '保存本次演奏录音？': 'Save this performance recording?',
    '包含演奏混音；打开麦克风时同时录入人声': 'Includes the performance mix and microphone when enabled',
    '准备文件…': 'Preparing file…', '不要': 'No', '保存': 'Save', '演奏结算': 'Results',
    '总判定 0': 'TOTAL 0', '尚未连击': 'No combo yet', '返回选歌': 'Back to library',
    '降': 'Key −', '升': 'Key +', '拨A': 'Pick A', '鼓A': 'Drum A', '主': 'Melody', '结束': 'End',
    '录音保存': 'Save recording', '人声回放 关': 'Vocal monitor off',
    '点击上方琴键弹单音，使用下方和弦键的 A / B 区域自由伴奏。': 'Play notes on the upper keyboard and use A/B areas below for chord backing.',
    '和弦': 'Chord', '风格': 'Style', '主旋律键盘': 'Melody keyboard', '和弦触发键盘': 'Chord keyboard',
    'A 左下': 'A lower-left', 'B 右上': 'B upper-right', '轻触切换 · 拖动移动': 'Tap to switch · Drag to move',
    '搜索歌曲或歌手': 'Search songs or artists', '清除搜索': 'Clear search', '选择歌曲': 'Song library',
    '曲库搜索与筛选': 'Library search and filters', '歌手快捷筛选': 'Artist shortcuts', '按歌手筛选': 'Filter by artist',
    '按语言筛选': 'Filter by language', '按版本筛选': 'Filter by chart', '歌曲排序': 'Sort songs',
    '关闭筛选': 'Close filter', '关闭筛选面板': 'Close filter panel', '过滤选项': 'Filter options', '返回选歌': 'Back to library',
    '当前歌曲只提供一套鼓机音色': 'This song provides one drum kit', '这个浏览器不支持麦克风录音': 'Microphone recording is not supported',
    '麦克风没有授权，录音里不会有人声': 'Microphone permission was not granted; vocals will not be recorded', '自定义': 'Custom',
    '外放禁用': 'Speaker blocked', '检查耳机并继续': 'Check headphones and continue', '已自动关闭回放': 'Monitoring stopped automatically',
    '知道了': 'Got it', '已禁止扬声器回放': 'Speaker monitoring blocked', '无法确认输出设备': 'Audio output cannot be confirmed',
    '本地视频': 'Local video', '本地声音': 'Local audio', '轻触播放/暂停 · 拖动移动': 'Tap play/pause · Drag to move',
    '浏览器不支持': 'Not supported', '这个浏览器不支持摄像头预览': 'Camera preview is not supported', '未授权': 'Not authorized',
    '摄像头没有授权，演奏画面不会显示预览': 'Camera permission was not granted; no preview will be shown', '该方向不可用': 'This camera is unavailable',
    '正在连接…': 'Connecting…', '还没有可保存的演奏录音': 'There is no performance recording to save yet',
    '仅全自动模式可用': 'Available only in Auto mode', '未选择歌曲': 'No song selected', '自由演奏已准备': 'Free Play is ready',
    '曲目已准备': 'Song ready', '请选择自由演奏或一首歌曲': 'Choose Free Play or a song', '仅主旋律': 'Melody only',
    '选择曲目': 'Choose song', '自由演奏已载入': 'Free Play loaded', '载入失败，请重试': 'Loading failed. Please try again',
    '部分可用': 'Partially ready', '完成': 'Done', '正在检查演奏资源…': 'Checking performance resources…',
    '歌曲未使用鼓机': 'This song does not use drums', '当前风格未配置': 'No configuration for this style',
    '解析 MIDI / WASM / 风格包…': 'Parsing MIDI / WASM / style pack…', '解析 MIDI · WASM · 风格包': 'Parse MIDI · WASM · style pack',
    '启动音频引擎并缓存全部音色…': 'Starting audio and caching instruments…', '缓存真实钢琴采样': 'Cache real piano samples',
    '真实钢琴载入失败': 'Real piano failed to load', '备用音色可用': 'Fallback instrument ready', '合成鼓组可用': 'Synth drum kit ready',
    '等待浏览器授权': 'Waiting for browser permission', '录音输入已连接': 'Recording input connected', '未获得权限': 'Permission not granted',
    '当前未启用': 'Not enabled', '全部演奏资源已就绪': 'All performance resources are ready', '已暂停': 'Paused', '已停止': 'Stopped',
    '播放完成': 'Playback complete', '不支持 · 点击安装 MIDIWeb': 'Unsupported · Install MIDIWeb', '此浏览器不支持 Web MIDI': 'Web MIDI is not supported',
    '正在恢复 MIDI 连接…': 'Restoring MIDI connection…', '正在请求 MIDI 权限…': 'Requesting MIDI permission…',
    '已授权，等待 MIDI 设备': 'Authorized, waiting for a MIDI device', '前往 App Store 安装 MIDIWeb Browser': 'Install MIDIWeb Browser from the App Store',
    '确认后将检查音频输出。检测到手机扬声器时不会回放人声；无法确认时可在演奏页用“人声回放”开关手动控制。': 'Audio output will be checked next. Vocal monitoring stays off on phone speakers; if the route is unknown, use the Vocal Monitor switch during performance.',
    '检测到持续高电平，可能正在产生啸叫。麦克风录音仍然保持开启，仅关闭了人声回放。': 'Sustained high input may indicate feedback. Microphone recording remains active; only live monitoring was stopped.',
    '检测到当前输出为扬声器。为防止啸叫，人声不会外放；麦克风录音和美声处理仍然正常。': 'The current output is a speaker. Vocal monitoring is blocked to prevent feedback; recording and vocal effects remain active.',
    '浏览器无法判断当前是否连接耳机，因此没有自动打开人声回放。进入演奏后可使用“人声回放”开关手动控制，麦克风录音不受影响。': 'The browser cannot confirm headphones, so monitoring was not enabled automatically. Use Vocal Monitor during performance; recording is unaffected.',
  };

  const ja = {
    '今晚想演奏哪一首？': '今夜はどの曲を演奏しますか？',
    '选择自由演奏，或搜索歌曲和歌手进入演奏设置。': '自由演奏、または曲・歌手を検索して演奏設定へ進みます。',
    '自由演奏': '自由演奏', '不限时间 · BPM 自由调节 · 单音与和弦伴奏': '時間無制限・BPM調整・単音とコード伴奏',
    '进入设置': '設定へ', '歌手': '歌手', '全部歌手': 'すべての歌手', '语言': '言語', '全部语言': 'すべての言語',
    '中文': '中国語', '日文': '日本語', '纯音乐': 'インスト', '版本': '譜面', '全部版本': 'すべての譜面',
    '标准版': '標準版', '进阶版': '上級版', '排序': '並び順', '推荐': 'おすすめ', '热度': '人気', '歌名': '曲名',
    '没有找到歌曲': '曲が見つかりません', '试试缩短关键词或切换筛选条件': '検索語を短くするか、条件を変更してください',
    '显示更多': 'さらに表示', '请选择一首歌曲': '曲を選んでください', '选择筛选条件': '絞り込みを選択',
    '没有匹配的选项': '一致する項目がありません', '当前歌曲': '現在の曲', '演奏方式': '演奏方法', '模式': 'モード',
    '和弦触发': 'コード入力', '自动': '自動', '全自动和弦': '全自動コード', '一键': 'ワンキー',
    '任意键演奏': 'どのキーでも演奏', '辅助': 'アシスト', '半自动和弦': '半自動コード', '手动': '手動',
    '自由触发': '自由入力', '自由': 'フリー', '不限时间演奏': '時間無制限', '鼓机': 'ドラム', '节奏跟随': 'リズム追従',
    '智能': 'スマート', '跟随风格': 'スタイルに追従', '开启': 'オン', '持续伴奏': '連続伴奏', '关闭': 'オフ',
    '纯净演奏': 'ドラムなし', '拨片音色': 'ピック音色', '切换当前伴奏触感': '伴奏のタッチを切替',
    '鼓机音色': 'ドラム音色', '切换当前节奏鼓组': '現在のドラムキットを切替', '声音控制': 'ミキサー',
    '主旋律': 'メロディー', '伴奏': '伴奏', '演奏信号': '演奏入力', '旋律声部': 'メロディー声部',
    '开': 'オン', '关': 'オフ', '引导': 'イントロガイド', '歌词前主旋律': '歌詞前のメロディー',
    '麦克风': 'マイク', '美声': 'ボーカルFX', '设置': '設定', '素材来源': '素材ソース', '未选择素材': '素材未選択',
    '摄像头': 'カメラ', '视频': '動画', '声音': '音声', '视频声音': '動画音声', '是否加入演奏与录像': '演奏・録音に追加',
    '摄像头方向': 'カメラ方向', '进入演奏前选择镜头': '演奏前にカメラを選択', '前置': '前面', '后置': '背面',
    '麦克风工作室': 'マイクスタジオ', '处理后写入录音，不连接扬声器': '処理後の音声を録音し、スピーカーには出力しません',
    '原声': 'ナチュラル', '清亮': 'クリア', '温暖': 'ウォーム', '舞台': 'ステージ', '大厅': 'ホール',
    '润色': '補正', '混响': 'リバーブ', '回声': 'エコー', '延迟': 'ディレイ', 'MIDI 键盘': 'MIDIキーボード',
    '点击连接 USB / 蓝牙': 'USB / Bluetoothを接続', '设置会同步到演奏画面': '設定は演奏画面に反映されます',
    '进入演奏': '演奏開始', '正在准备演奏': '演奏を準備中', '核心谱面': 'コア譜面',
    'MIDI · WASM · 风格包': 'MIDI・WASM・スタイルパック', '等待': '待機中', '主旋律钢琴': 'メロディーピアノ',
    '动态采样音色': 'ダイナミックサンプル音色', '拨片 A': 'ピックA', '本曲所需音色与采样': 'この曲に必要な音色とサンプル',
    '拨片 B': 'ピックB', '歌曲所需 A/B 鼓组': '必要なA/Bドラムキット', '录音输入': '録音入力', '准备载入…': '読み込み準備中…',
    '请先佩戴耳机': 'ヘッドホンを装着してください',
    '确认佩戴耳机后，将立即打开人声回放，方便试听美声、混响、回声和延迟效果。': '装着を確認すると、ボーカルエフェクト確認用のモニターを開始します。',
    '扬声器外放可能产生啸叫；系统会在检测到持续自激时自动关闭回放。': 'スピーカーではハウリングの恐れがあり、検出時はモニターを自動停止します。',
    '暂不回放': '今はしない', '已戴耳机，开始回放': '装着済み・モニター開始', '保存本次演奏录音？': '今回の演奏録音を保存しますか？',
    '包含演奏混音；打开麦克风时同时录入人声': '演奏ミックスと、有効時はマイク音声を含みます', '准备文件…': 'ファイル準備中…',
    '不要': 'しない', '保存': '保存', '演奏结算': '演奏結果', '总判定 0': '総判定 0', '尚未连击': 'コンボなし',
    '返回选歌': '曲選択へ', '降': '下げる', '升': '上げる', '拨A': 'ピックA', '鼓A': 'ドラムA', '主': 'メロディー',
    '结束': '終了', '录音保存': '録音保存', '人声回放 关': 'ボーカルモニター オフ',
    '点击上方琴键弹单音，使用下方和弦键的 A / B 区域自由伴奏。': '上の鍵盤で単音、下のA/B領域でコード伴奏を演奏します。',
    '和弦': 'コード', '风格': 'スタイル', '主旋律键盘': 'メロディー鍵盤', '和弦触发键盘': 'コード鍵盤',
    'A 左下': 'A 左下', 'B 右上': 'B 右上', '轻触切换 · 拖动移动': 'タップで切替・ドラッグで移動',
    '搜索歌曲或歌手': '曲または歌手を検索', '清除搜索': '検索を消去', '选择歌曲': '曲を選択',
    '曲库搜索与筛选': '曲ライブラリの検索と絞り込み', '歌手快捷筛选': '歌手クイックフィルター',
    '按歌手筛选': '歌手で絞り込み', '按语言筛选': '言語で絞り込み', '按版本筛选': '譜面で絞り込み',
    '歌曲排序': '曲の並び順', '关闭筛选': '絞り込みを閉じる', '关闭筛选面板': '絞り込みパネルを閉じる', '过滤选项': '項目を検索',
    '当前歌曲只提供一套鼓机音色': 'この曲のドラム音色は1種類です', '这个浏览器不支持麦克风录音': 'このブラウザはマイク録音に対応していません',
    '麦克风没有授权，录音里不会有人声': 'マイクが許可されていないため、ボーカルは録音されません', '自定义': 'カスタム',
    '外放禁用': 'スピーカー無効', '检查耳机并继续': 'ヘッドホンを確認して続行', '已自动关闭回放': 'モニターを自動停止しました',
    '知道了': '了解', '已禁止扬声器回放': 'スピーカーモニターを禁止しました', '无法确认输出设备': '出力機器を確認できません',
    '本地视频': 'ローカル動画', '本地声音': 'ローカル音声', '轻触播放/暂停 · 拖动移动': 'タップで再生・停止／ドラッグで移動',
    '浏览器不支持': '非対応', '这个浏览器不支持摄像头预览': 'このブラウザはカメラプレビューに対応していません', '未授权': '未許可',
    '摄像头没有授权，演奏画面不会显示预览': 'カメラが許可されていないためプレビューは表示されません', '该方向不可用': 'このカメラは利用できません',
    '正在连接…': '接続中…', '还没有可保存的演奏录音': '保存できる演奏録音はまだありません',
    '仅全自动模式可用': '全自動モードのみ利用可能', '未选择歌曲': '曲が選択されていません', '自由演奏已准备': '自由演奏の準備完了',
    '曲目已准备': '曲の準備完了', '请选择自由演奏或一首歌曲': '自由演奏または曲を選んでください', '仅主旋律': 'メロディーのみ',
    '选择曲目': '曲を選択', '自由演奏已载入': '自由演奏を読み込みました', '载入失败，请重试': '読み込みに失敗しました。再試行してください',
    '部分可用': '一部利用可能', '完成': '完了', '正在检查演奏资源…': '演奏リソースを確認中…',
    '歌曲未使用鼓机': 'この曲はドラムを使用しません', '当前风格未配置': '現在のスタイルは未設定です',
    '解析 MIDI / WASM / 风格包…': 'MIDI / WASM / スタイルを解析中…', '解析 MIDI · WASM · 风格包': 'MIDI・WASM・スタイルを解析',
    '启动音频引擎并缓存全部音色…': 'オーディオを起動し音色をキャッシュ中…', '缓存真实钢琴采样': 'リアルピアノをキャッシュ',
    '真实钢琴载入失败': 'リアルピアノの読み込み失敗', '备用音色可用': '代替音色を利用可能', '合成鼓组可用': '合成ドラムを利用可能',
    '等待浏览器授权': 'ブラウザの許可を待っています', '录音输入已连接': '録音入力を接続しました', '未获得权限': '許可されていません',
    '当前未启用': '現在無効', '全部演奏资源已就绪': 'すべての演奏リソースの準備完了', '已暂停': '一時停止', '已停止': '停止',
    '播放完成': '再生完了', '不支持 · 点击安装 MIDIWeb': '非対応・MIDIWebをインストール', '此浏览器不支持 Web MIDI': 'このブラウザはWeb MIDI非対応です',
    '正在恢复 MIDI 连接…': 'MIDI接続を復元中…', '正在请求 MIDI 权限…': 'MIDI権限を要求中…',
    '已授权，等待 MIDI 设备': '許可済み・MIDI機器を待機中', '前往 App Store 安装 MIDIWeb Browser': 'App StoreでMIDIWeb Browserをインストール',
    '确认后将检查音频输出。检测到手机扬声器时不会回放人声；无法确认时可在演奏页用“人声回放”开关手动控制。': '次に音声出力を確認します。スマートフォンのスピーカーではボーカルをモニターせず、判別できない場合は演奏画面のスイッチで操作できます。',
    '检测到持续高电平，可能正在产生啸叫。麦克风录音仍然保持开启，仅关闭了人声回放。': '持続する高レベルを検出しました。マイク録音は継続し、ボーカルモニターのみ停止しました。',
    '检测到当前输出为扬声器。为防止啸叫，人声不会外放；麦克风录音和美声处理仍然正常。': '現在の出力はスピーカーです。ハウリング防止のためモニターを止めますが、録音とボーカル処理は継続します。',
    '浏览器无法判断当前是否连接耳机，因此没有自动打开人声回放。进入演奏后可使用“人声回放”开关手动控制，麦克风录音不受影响。': 'ブラウザがヘッドホンを確認できないため、自動モニターは開始しません。演奏画面で手動操作でき、録音には影響しません。',
  };

  const traditionalChars = new Map(Object.entries({
    '选':'選','择':'擇','乐':'樂','词':'詞','进':'進','设':'設','调':'調','节':'節','单':'單','与':'與','声':'聲','关':'關','开':'開','启':'啟','击':'擊','键':'鍵','发':'發','动':'動','辅':'輔','随':'隨','净':'淨','拨':'撥','换':'換','当':'當','触':'觸','机':'機','组':'組','录':'錄','频':'頻','摄':'攝','头':'頭','处':'處','连':'連','场':'場','厅':'廳','润':'潤','迟':'遲','蓝':'藍','备':'備','载':'載','显':'顯','总':'總','结':'結','数':'數','这':'這','还':'還','试':'試','缩':'縮','简':'簡','条':'條','优':'優','复':'複','体':'體','滤':'濾','输':'輸','过':'過','个':'個','从':'從','写':'寫','图':'圖','灯':'燈','标':'標','页':'頁','画':'畫','听':'聽','览':'覽','视':'視','并':'並','长':'長','应':'應','华':'華','说':'說','对':'對','时':'時','间':'間','万':'萬','无':'無','为':'為','将':'將','实':'實','现':'現','测':'測','样':'樣','览':'覽','查':'查','习':'習','爱':'愛','让':'讓','边':'邊','里':'裡','后':'後','达':'達','请':'請','闭':'閉','统':'統','码':'碼','毕':'畢','库':'庫','曲':'曲','该':'該','术':'術','从':'從','么':'麼','种':'種','广':'廣','东':'東','网':'網','称':'稱','显':'顯','乐':'樂','纯':'純','滤':'濾','继':'繼','续':'續','暂':'暫','认':'認','确':'確','会':'會','写':'寫','盘':'盤','气':'氣','览':'覽','户':'戶','镜':'鏡','择':'擇'
  }));
  const toTraditional = text => Array.from(text, char => traditionalChars.get(char) || char).join('');
  const zhHant = Object.fromEntries(Object.keys(en).map(key => [key, toTraditional(key)]));
  Object.assign(zhHant, {
    '今晚想演奏哪一首？': '今晚想演奏哪一首？', '选择自由演奏，或搜索歌曲和歌手进入演奏设置。': '選擇自由演奏，或搜尋歌曲和歌手進入演奏設定。',
    '搜索歌曲或歌手': '搜尋歌曲或歌手', '没有找到歌曲': '沒有找到歌曲', '显示更多': '顯示更多',
    '视频': '影片', '摄像头': '攝影機', '摄像头方向': '攝影機方向', '前置': '前置', '后置': '後置',
  });
  const yue = { ...zhHant,
    '今晚想演奏哪一首？': '今晚想彈邊一首？',
    '选择自由演奏，或搜索歌曲和歌手进入演奏设置。': '揀自由演奏，或者搜尋歌曲同歌手進入演奏設定。',
    '进入设置': '入設定', '没有找到歌曲': '搵唔到歌曲', '试试缩短关键词或切换筛选条件': '試下縮短關鍵字或者轉篩選條件',
    '请选择一首歌曲': '請揀一首歌', '显示更多': '顯示更多', '当前歌曲': '而家首歌', '声音控制': '聲音控制',
    '进入演奏': '開始演奏', '返回选歌': '返去揀歌', '不要': '唔要', '关': '關', '开': '開',
  };

  const dictionaries = Object.freeze({ en, ja, 'zh-Hant': zhHant, yue, 'zh-Hans': Object.freeze({}) });
  const textState = new WeakMap();
  const attrState = new WeakMap();
  let mode = 'auto';
  let effective = 'zh-Hans';
  let observer = null;

  function detect() {
    const languages = Array.from(navigator.languages || [navigator.language || 'zh-CN'], value => String(value).toLowerCase());
    for (const language of languages) {
      if (language.startsWith('yue') || language.includes('zh-hk') || language.includes('zh-mo')) return 'yue';
      if (language.includes('zh-hant') || language.includes('zh-tw')) return 'zh-Hant';
      if (language.startsWith('ja')) return 'ja';
      if (language.startsWith('en')) return 'en';
      if (language.startsWith('zh')) return 'zh-Hans';
    }
    return 'zh-Hans';
  }

  function translate(source) {
    const plain = String(source ?? '');
    const direct = dictionaries[effective]?.[plain];
    if (direct) return direct;
    const songs = plain.match(/^(\d+)\s*首$/);
    if (songs) return effective === 'en' ? `${songs[1]} tracks` : effective === 'ja' ? `${songs[1]}曲` : `${songs[1]} 首`;
    const options = plain.match(/^(\d+)\s*个选项$/);
    if (options) return effective === 'en' ? `${options[1]} options` : effective === 'ja' ? `${options[1]}項目` : `${options[1]} 個選項`;
    return plain;
  }

  function applyText(node) {
    if (!node?.nodeValue || !node.parentElement || /^(SCRIPT|STYLE|TEXTAREA)$/.test(node.parentElement.tagName)) return;
    let state = textState.get(node);
    if (!state) state = { source: node.nodeValue, last: node.nodeValue };
    else if (node.nodeValue !== state.last) state.source = node.nodeValue;
    const next = translate(state.source);
    state.last = next;
    textState.set(node, state);
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function applyAttributes(element) {
    if (!(element instanceof Element)) return;
    let states = attrState.get(element);
    if (!states) states = new Map();
    for (const name of ['aria-label', 'placeholder', 'title']) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name);
      let state = states.get(name);
      if (!state) state = { source: current, last: current };
      else if (current !== state.last) state.source = current;
      const next = translate(state.source);
      state.last = next;
      states.set(name, state);
      if (current !== next) element.setAttribute(name, next);
    }
    attrState.set(element, states);
  }

  function applyTree(root = document.documentElement) {
    if (root.nodeType === Node.TEXT_NODE) applyText(root);
    if (root.nodeType === Node.ELEMENT_NODE) applyAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) applyText(walker.currentNode);
      else applyAttributes(walker.currentNode);
    }
  }

  function autoLabel() {
    return ({ en: 'Auto', ja: '自動', 'zh-Hant': '自動', yue: '自動', 'zh-Hans': '自动' })[effective];
  }

  function updateMenu() {
    const button = document.getElementById('uiLanguageButton');
    const menu = document.getElementById('uiLanguageMenu');
    const auto = menu?.querySelector('[data-ui-language="auto"]');
    if (auto) auto.textContent = autoLabel();
    menu?.querySelectorAll('[data-ui-language]').forEach(option => {
      const selected = option.dataset.uiLanguage === mode;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
    button?.setAttribute('aria-label', effective === 'en' ? 'Interface language' : effective === 'ja' ? '表示言語' : effective === 'yue' ? '介面語言' : effective === 'zh-Hant' ? '介面語言' : '界面语言');
  }

  function setMode(next, { persist = true } = {}) {
    if (!MODES.includes(next)) next = 'auto';
    mode = next;
    effective = mode === 'auto' ? detect() : mode;
    if (persist) localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.lang = ({ yue: 'yue-Hant-HK', 'zh-Hant': 'zh-Hant', ja: 'ja', en: 'en', 'zh-Hans': 'zh-CN' })[effective];
    applyTree();
    updateMenu();
    globalThis.dispatchEvent(new CustomEvent('freeza:languagechange', { detail: { mode, language: effective } }));
  }

  function closeMenu({ restoreFocus = false } = {}) {
    const button = document.getElementById('uiLanguageButton');
    const menu = document.getElementById('uiLanguageMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button?.focus({ preventScroll: true });
  }

  function mount() {
    const button = document.getElementById('uiLanguageButton');
    const menu = document.getElementById('uiLanguageMenu');
    if (!button || !menu || button.dataset.mounted === 'true') return;
    button.dataset.mounted = 'true';
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('.selected')?.focus({ preventScroll: true });
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('[data-ui-language]');
      if (!option) return;
      setMode(option.dataset.uiLanguage);
      closeMenu({ restoreFocus: true });
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.ui-language-picker')) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu({ restoreFocus: true });
    });
    globalThis.addEventListener('languagechange', () => {
      if (mode === 'auto') setMode('auto', { persist: false });
    });
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') applyText(record.target);
        else for (const node of record.addedNodes) applyTree(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const saved = localStorage.getItem(STORAGE_KEY);
    setMode(MODES.includes(saved) ? saved : 'auto', { persist: false });
  }

  globalThis.FreezaUiLanguage = Object.freeze({ mount, setMode, translate, modes: MODES, get mode() { return mode; }, get language() { return effective; } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

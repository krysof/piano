# LiberLive C2 Player Pattern Bundle

包含完整 354 个 C2 伴奏/分解和弦/鼓机 pattern。

## 文件
- catalog/player_patterns_manifest.json：播放器优先读取的总索引。
- catalog/chord_patterns.json：只含和弦/分解伴奏 pattern。
- catalog/drum_patterns.json：只含鼓机 pattern。
- catalog/patterns_full.json：从 OTA files.json 解出的完整原始字段。
- pattern_midis/*.mid：每个 pattern 对应一个可直接播放/预览的 MIDI。

## 约定
- beat 为拍单位；生成 MIDI 使用 480 ticks/beat。
- chord pattern 的 pitch 是模板音高，需要按当前和弦根音/类型移调或重配音。
- drum pattern 建议走 MIDI channel 10，或由播放器自行映射鼓采样。
- 所有 354 个 pattern 都有 notes 和 MIDI 文件。

# Magic Tiles Lite v8

本版根据测试反馈调整：

- 反馈文字（Perfect / Good / OK / Late / Miss）上移到屏幕中部偏上位置。
- 方块超过白线后，不会马上算 Miss。
- 如果方块超过白线但还没有完全离开屏幕，玩家点到对应轨道时显示 `Late`。
- `Late` 不加分、不增加 Miss，也不扣分；该方块会被移除。
- 只有方块完全离开屏幕底部后仍未处理，才算 `Miss`。
- 保留 v7 的时间判定规则：Perfect ≤ 0.07s，Good ≤ 0.14s，OK ≤ 0.22s，太早点击显示 Early。

歌曲仍放在：

```text
public/audio/song.mp3
```

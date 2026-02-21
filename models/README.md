# YOLO ONNX 模型放置位置

預設偵測路徑：

`/models/card-detector.onnx`

目前已放入可直接使用的模型：
- 模型檔：`card-detector.onnx`
- 標籤檔：`card-detector.labels.json`（classId -> 牌面標籤）
- 來源：Hugging Face `mustafakemal0146/playing-cards-yolov8`
- 原始權重：`playing_cards_model_0_playing-cards-colab.pt`
- 轉換方式：Ultralytics `export(format='onnx')`

## 備註

- 若你有自己的模型，可在 UI 直接上傳 `.onnx` 檔。
- 若要自動帶入牌面，請同時提供對應 labels（classId 對應到牌面標籤）。
- 或覆蓋 `public/models/card-detector.onnx` / `card-detector.labels.json` 使用預設路徑。

## 參考來源

- https://huggingface.co/mustafakemal0146/playing-cards-yolov8

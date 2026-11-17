# Sources and open-source notices

This application implements its own interface and JavaScript data adapters. The public data request/field contracts were checked against:

- [AKShare](https://github.com/akfamily/akshare), MIT: Eastmoney fund ranking and estimate page contracts.
- [z8-ui/stock-tracker](https://github.com/z8-ui/stock-tracker), MIT, © 2026 z8-ui: Eastmoney flow field mapping, yuan/yi conversion and sector pagination. Its mock-fallback functionality is not used.
- [zhengshengning/fund-baby](https://github.com/zhengshengning/fund-baby), AGPL-3.0: reviewed for product capabilities; its source code is not bundled or copied.
- ECharts, Apache-2.0, and zrender, BSD-3-Clause, bundled by the client build. License copies are in `licenses/`.

Market data remains owned by its respective provider. These public endpoints have no availability guarantee. The application does not use premium credentials, bypass a subscription, or imply permission to redistribute a licensed real-time feed.

## MIT license — stock-tracker

Copyright (c) 2026 z8-ui

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 本机 OCR

Tesseract.js 7 和 tesseract.js-core 使用 Apache-2.0；构建产物在 `licenses/` 附其授权文本。中文/英文模型通过 MIT 标注的 `@tesseract.js-data/chi_sim`、`@tesseract.js-data/eng` npm 包获取，模型来源为 [naptha/tessdata](https://github.com/naptha/tessdata) / [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata)。模型与引擎同站点托管，图片只在浏览器处理。官方API参考：[Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)。

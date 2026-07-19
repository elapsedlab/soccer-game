# 快樂足球

俯視角 2D 足球小遊戲：你（藍隊）對戰電腦 AI（紅隊），3 分鐘一場，進球多者獲勝。

純 HTML5 Canvas + vanilla JavaScript，無框架、無 build step，部署為 Cloudflare Worker（static assets）。

## 玩法

| 平台 | 移動 | 射門 |
|------|------|------|
| 電腦 | 方向鍵或 WASD | 空白鍵 |
| 手機 | 左側虛擬搖桿（按住拖曳） | 右下「射門」按鈕 |

- 靠近球會自然帶球；按射門朝面向方向大力踢出
- 兩隊各有自動守門員，會擋球並解圍
- 終場依比分顯示勝負，可立即再開一場

## 本機開發

```bash
npx wrangler dev        # 或任何靜態伺服器：python3 -m http.server -d public
```

## Docker

```bash
docker compose up -d    # http://localhost:8080
```

以 nginx 直接掛載 `public/` 目錄提供服務，改檔案立即生效（重新整理頁面即可），適合本機或自架伺服器不走 Cloudflare 的情況。

## 部署

```bash
npx wrangler deploy     # 需要 Cloudflare 帳號（wrangler login）
```

或在 Cloudflare Dashboard → Workers & Pages → Create → 連結此 GitHub repo（Workers Builds），之後 push 到 `main` 即自動部署。

## 專案結構

```
public/
  index.html   # 頁面骨架與 UI（HUD、開始/結束畫面、觸控元件）
  style.css    # 版面與觸控控制樣式
  game.js      # 遊戲主體：物理、AI、守門員、輸入、渲染、賽事流程
wrangler.toml  # Cloudflare Worker 設定（assets-only）
```

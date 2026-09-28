# わだちログ（wadachi-log）セットアップ手順

サイクリング・ドライブのルートを地図に描き、立ち寄り先の写真・動画・メモをピンで残すWebアプリ。
構成：GitHub Pages（index.html 1ファイル）＋ Google Apps Script ＋ スプレッドシート ＋ Google ドライブ ＋ Gemini API

```
wadachi-log/
├─ index.html   … フロントエンド（GitHub Pages に置く）
├─ Code.gs      … バックエンド（Apps Script に貼る）
└─ README.md
```

---

## 1. スプレッドシート設計

`setup()` を実行すると3シートが自動作成されます（全列「書式なしテキスト」）。

### Users（会員）

| 列 | 内容 |
|---|---|
| userId | `u_xxxxxxxx` |
| email | 小文字に正規化したメールアドレス（ログインID） |
| displayName | 表示名（30文字まで） |
| salt | ユーザーごとのソルト |
| passwordHash | SHA-256（ソルト＋パスワード＋ペッパー、200回ストレッチ） |
| mustChangePassword | `TRUE` なら次回ログイン時にパスワード変更を強制（新規登録時・再発行時） |
| tokenVersion | パスワード変更・再発行で +1 → 他端末のログインを無効化 |
| failedCount | ログイン連続失敗回数（5回で15分ロック） |
| lockedUntil | ロック解除日時（ISO） |
| createdAt / updatedAt / lastLoginAt | ISO日時（lastLoginAt が空＝仮パスワードのまま未ログイン） |

### Trips（トリップ）

| 列 | 内容 |
|---|---|
| tripId / userId | `t_xxxxxxxx` / 所有者 |
| title / tripType / description | タイトル / `cycling`・`drive`・`other` / メモ |
| startDate / endDate | `YYYY-MM-DD` |
| distanceKm / elevationGainM / durationSec / pointCount | ルートの集計値（クライアントで計算） |
| routeName / routeFileId | ルート名 / Drive上のルートJSONのファイルID |
| aiSummary / aiHighlights / aiSns | Gemini 生成文（日誌の要約 / 見どころ / SNS・ブログ） |
| createdAt / updatedAt | ISO日時 |
| visibility | 公開範囲。`private`（自分だけ・既定）/ `members`（登録会員に公開）。空欄は `private` 扱い |

ルートの座標はセル上限（5万文字）を超えるため、Drive の `routes/` に JSON（`{name, points:[[lat,lng,ele,timeMs],…]}`）で保存し、IDだけをシートに持ちます。

### Waypoints_Media（スポット＋メディア）

| 列 | 内容 |
|---|---|
| spotId / tripId / userId | `s_xxxxxxxx` / 親トリップ / 所有者 |
| lat / lng | 小数6桁 |
| title / memo | 場所の名前 / メモ |
| takenAt | 撮影・訪問日時（Exifの撮影日時が入る） |
| source | `exif`（写真の位置情報）/ `map`（地図タップ） |
| mediaJson | `[{fileId, mimeType, name}]` 1スポット最大30件 |
| createdAt / updatedAt | ISO日時 |

### Comments（コメント）

| 列 | 内容 |
|---|---|
| commentId / tripId / userId | `c_xxxxxxxx` / 対象トリップ / 投稿者 |
| body | 本文（1000文字まで） |
| createdAt / updatedAt | ISO日時（異なれば「編集済み」表示） |

### Likes（いいね）

| 列 | 内容 |
|---|---|
| tripId / userId / createdAt | 1会員につき1トリップ1件。もう一度押すと取り消し |

Comments・Likes シートは、初めて使われたときに自動で作成されます。

### Google ドライブのフォルダ構成（自動作成）

```
wadachi-log-data/
├─ routes/            … ルートJSON（非公開・GAS経由でのみ読む）
└─ media/<tripId>/    … 写真・動画（リンクを知っている全員が閲覧可）
```

---

## 2. Google Apps Script の設定

1. 新しいスプレッドシートを作成（名前は任意。例：`wadachi-log-db`）
2. **［拡張機能］→［Apps Script］** を開き、既存コードを消して `Code.gs` を貼り付けて保存
3. **［プロジェクトの設定］（歯車）→ タイムゾーン** を `(GMT+09:00) 東京` にする
4. エディタ上部の関数選択で **`setup`** を選び **［実行］** → 権限の承認（スプレッドシート・ドライブ・Gmail・外部接続）
   - 実行ログに `セットアップ完了` と出ればOK
5. **［プロジェクトの設定］→［スクリプト プロパティ］** を確認・追加

| プロパティ | 設定 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | **手動で追加** | Google AI Studio で発行したキー |
| `APP_URL` | 任意で追加 | `https://kenken6291.github.io/wadachi-log/`（仮パスワードメールに載せるURL） |
| `GEMINI_MODEL` | 任意 | 省略時 `gemini-2.5-flash` |
| `SPREADSHEET_ID` | setupで自動 | 変更不要 |
| `DRIVE_FOLDER_ID` | setupで自動 | 既存フォルダを使いたい場合はそのIDに書き換え |
| `TOKEN_SECRET` / `PEPPER` | setupで自動 | **絶対に変更しない**（変えると全員ログイン不可になる） |

6. （任意）関数 `testGemini` を実行 → ログに「接続テスト成功」が出ればAPIキーOK
7. **［デプロイ］→［新しいデプロイ］** → 種類の歯車から **ウェブアプリ**
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**
   - ［デプロイ］→ 表示された **ウェブアプリURL（…/exec）** をコピー

> ⚠️ **Code.gs を修正したら必ず再デプロイ**：［デプロイ］→［デプロイを管理］→ 鉛筆アイコン → バージョン「**新バージョン**」→［デプロイ］。保存だけでは本番URLに反映されません（URLは変わりません）。

---

## 3. GitHub Pages の設定

1. GitHub で `wadachi-log` リポジトリを作成
2. `index.html` 冒頭の設定を書き換える

```js
const GAS_URL = 'https://script.google.com/macros/s/xxxxxxxxxxxx/exec';
```

3. `index.html` をリポジトリ直下にプッシュ
4. **Settings → Pages** → Source: `Deploy from a branch` / Branch: `main` / `/ (root)` → Save
5. 数分後 `https://kenken6291.github.io/wadachi-log/` で公開

---

## 4. CORS について

- フロントは `fetch(GAS_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON })` で送信しています。
  `text/plain` は「単純リクエスト」なのでプリフライト（OPTIONS）が発生せず、GAS 側で CORS ヘッダーを付けなくても応答を読めます。
- GAS は `ContentService.createTextOutput(JSON).setMimeType(JSON)` で返し、ブラウザは 302 リダイレクト先（googleusercontent.com）から JSON を受け取ります。
- `doGet` は動作確認用。`GAS_URL?callback=cb` で JSONP 応答も返せます。
- 外部URLのルートファイルがCORSで読めない場合、ログイン中はGAS（`fetchRemote`）が代わりに取得します。

---

## 5. 使い方の流れ

1. 新規登録（メールアドレス＋表示名）→ 届いた仮パスワードでログイン → 新しいパスワードを設定 → ヘッダーの **＋ 新しいトリップ**（GPXを同時に読み込むと距離・日付が自動入力）
2. **写真・動画を追加** → Exifに位置情報がある写真は撮影地点に自動でピンが立つ（80m以内に続けて撮った写真は1か所にまとまる）
   位置情報のない写真・動画は、続けて地図をタップして場所を決める
3. **ピンを打つ** → 地図をタップしてメモだけのスポットも作成可能
4. **ルートを再生** → 地図上でルートを走るアニメーション／標高グラフをなぞると地図上に位置を表示
5. **AIでまとめる** タブ → 日誌の要約・見どころ解説・SNS/ブログ投稿文を生成（写真の内容も読み取り可）
6. **ルートを読み込む →「画像から」** → GPSファイルが無くても、記録アプリのアクティビティマップのスクリーンショットから経路を作成
   - Gemini が線の形と地名（緯度経度つき）を読み取り、地名を基準点にして線を地図座標へ変換
   - 「道路に沿わせる」（OSRM：routing.openstreetmap.de、サイクリングは自転車用・それ以外は車用）と「画像の線のまま」を切替可能
   - 向きが分からない画像は「向きを反転」でスタート／ゴールを入れ替え
   - 標高・時刻は画像に無いため、獲得標高と所要時間は空欄になります
7. **公開範囲** → トリップごとに「🔒 非公開（既定）」「👥 会員に公開」を選択。トリップ画面の公開バッジをタップしても切替可
   - 公開したトリップは「みんなの公開ルート」タブに並び、ログイン中の会員が閲覧できる（編集・AI生成・削除は所有者のみ）
   - 写真・動画はDriveの「リンクを知っている全員」設定のため、URLを直接知っていれば会員以外も開ける点に注意
8. **いいね・コメント** → 自分のトリップと会員に公開されたトリップに書き込める
   - いいね：1人1回、もう一度押すと取り消し
   - コメント：投稿・修正は書いた本人、削除は書いた本人とトリップの所有者
   - トリップを非公開に戻すと、他の会員はコメント・いいねも見られなくなる（データは残る）
9. **GPXで書き出す／共有コードをコピー** → 他の人に渡したルートは「テキスト・共有コード」タブに貼れば読み込める

ログインしていなくても、GPX等を地図にドロップすればプレビュー（距離・標高・再生）は使えます。

---

## 6. 仕様・制限メモ

| 項目 | 内容 |
|---|---|
| ルート形式 | GPX（trk/rte/wpt）、KML（LineString / gx:Track）、GeoJSON（LineString / MultiLineString）。KMZ は非対応 |
| ルート点数 | 8,000点を超えると均等に間引いて保存 |
| 写真 | ブラウザで長辺2048px・JPEGに縮小してからアップロード（位置情報は縮小前に読み取り） |
| 動画 | 1本 28MB まで（GASへの送信上限対策）。長い動画は切り出してから |
| 写真表示 | Drive の `thumbnail?id=…` を使用。Google Workspace の組織アカウントで「外部共有禁止」だと表示されません（個人Gmail推奨） |
| 仮パスワード | 新規登録・再発行とも `GmailApp.sendEmail` で送信。同じアドレスへの連続送信は2分間ブロック。未ログインのまま再登録すると仮パスワードを再発行。Gmail の送信上限は個人アカウントで1日100通程度 |
| パスワード表示 | ログイン・仮パスワード・新パスワード・確認欄のすべてに目のアイコンで表示／非表示切替 |
| ログイン保持 | HMAC署名トークン（30日）を localStorage に保存。パスワード変更で他端末は自動ログアウト |
| 地図 | OpenStreetMap（標準）／地理院タイル淡色・航空写真を右上で切替 |

### よくあるつまずき

- **「サーバーの応答を読み取れませんでした」** → デプロイのアクセス設定が「全員」になっているか確認
- **写真が灰色のまま** → Drive にアップロード直後は数十秒サムネイルが生成されないことがあります。しばらくして再読み込み
- **Gemini API エラー（429）** → 無料枠の回数制限。時間をおいて再実行
- **コードを直したのに変わらない** → GAS の再デプロイ（新バージョン）忘れ、または GitHub Pages のキャッシュ（Ctrl+F5）

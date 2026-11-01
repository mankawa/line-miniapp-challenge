# みんなでチャレンジ（LINEミニアプリ）

LINEグループの仲間で「1ヶ月禁酒」みたいなチャレンジを競争するためのミニアプリ。

- 参加時に自分の目標を登録（「禁酒」「フラフープ1日100回」など、人によって違ってOK）
- 毎日、大きな「できた！（○）」「まあまあ（△）」「できなかった（✕）」ボタン（今日と昨日の分だけ記録・修正できる）
- △は0.5日ぶんで計算。連続記録は△なら途切れない
- みんなの達成日数ランキング＋連続記録
- 期間のカレンダー。「できなかった」と「未入力」は別表示
- 招待リンクをグループに貼る → 開いた人が目標を決めて参加

## 構成

| 場所 | 中身 |
| --- | --- |
| `docs/` | 画面（静的HTML/JS）。GitHub Pages で公開 |
| `supabase/functions/challenge-api` | API。LINEのIDトークンを検証して本人を特定 |
| `supabase/migrations` | テーブル定義。既存プロジェクト `small-salon-demo` の `challenge` スキーマに隔離 |

`challenge` スキーマは外部APIに公開しておらず、Edge Function からDB直結でのみ読み書きする。

## LINE側のセットアップ

1. [LINE Developers コンソール](https://developers.line.biz/console/) でプロバイダーを選ぶ（なければ作る）
2. 「新規チャネル作成」→「LINEミニアプリ」を選んで作る（未認証のまま公開できる）
3. 「ウェブアプリ設定」で
   - エンドポイントURL：`https://mankawa.github.io/line-miniapp-challenge/`（開発用・本番用とも）
   - Scope：`openid` と `profile` をオン
   - シェアターゲットピッカー：オン（「LINEで送る」ボタン用。オフでも動く）
4. 次の2つを控える
   - **チャネルID**（チャネル基本設定にある数字）
   - **LIFF ID**（ウェブアプリ設定にある `1234567890-xxxxxxxx` 形式）
5. 2つを設定する
   - `docs/config.js` の `LIFF_ID` に LIFF ID を入れて push
   - DB にチャネルIDを登録（開発用・審査用・本番用をカンマ区切り）：
     ```sql
     insert into challenge.config (key, value) values ('line_channel_id', '<開発用ID>,<審査用ID>,<本番用ID>')
     on conflict (key) do update set value = excluded.value;
     ```
6. コンソールでミニアプリを公開する

## 使い方

1. LINEで `https://miniapp.line.me/<LIFF ID>` を開く
2. チャレンジ名・開始日・期間を決めて「チャレンジを作る」
3. 自分の目標を決めて参加 →「LINEで送る」or「リンクをコピー」でグループに招待リンクを貼る
4. みんな毎日ボタンを押すだけ

## ローカルで画面を試す

`docs/config.js` の `LIFF_ID` が空、または URL に `?mock=1` を付けると、LINEにつながないお試しモードで動く（ダミーの友だち3人入り）。

```bash
python3 -m http.server 5188 --directory docs
```

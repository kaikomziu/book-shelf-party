# 📚 本を棚に戻すゲーム (book-shelf-party)

友達と部屋番号を入力してつながるマルチプレイ協力3Dゲーム。
床に散らばった本を拾い（インタラクトボタン / Eキー）、本来の場所（本棚）が光るのでそこへ運んで収める。全冊を棚に戻せばクリア。

- 🌍 誰でも自由に出入りできる公開ルームあり
- 部屋を新規に作るとき、本の冊数を 500 / 1000 / 2000 から選べる（既存の部屋番号ならその部屋が最初に作られた時の冊数が使われる）
- GitHub Pages でホストできる完全な静的サイト（サーバー不要）。マルチプレイの同期は共有 Supabase(Realtime + RPC) を使用

## セットアップ（初回のみ）

このゲームは共有 Supabase プロジェクト `kifnzvktwbomxthzvvgy` を使う。**公開前に一度だけ**、[Supabase の SQL Editor](https://supabase.com/dashboard/project/kifnzvktwbomxthzvvgy/sql/new) で [`supabase/bookshelf.sql`](supabase/bookshelf.sql) の内容を実行しておくこと（テーブル・RPC・Realtime配信設定・公開ルームの初期データを作成する）。

## ローカルで確認する

Node 不要。任意の静的サーバーで配信するだけ（例）:

```bash
npx serve .
# または
python -m http.server 5500
```

ブラウザで `http://localhost:5500`（ポートは使ったコマンドに合わせる）を開く。

## 操作方法

- W / S : 前進・後退
- A / D : 回転
- E またはインタラクトボタン : 本を拾う・置く

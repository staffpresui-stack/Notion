# MTG議事録自動化：Codex 用の指示書一式

現在はfinance@premiere-mode.co.jpのGASと共有ドライブを使います。最新の設定値と実行順は [共有ドライブ実行手順](docs/SHARED_DRIVE_TEST.md) を参照してください。Notionのオーナー・内部インテグレーションはcontact@のままです。

プレミアモード社の Codex 環境で、議事録自動化（Google Meet／tl;dv → ChatGPT → GAS → Drive・Notion・Chatwork・確認画面）を構築するための資料です。Codex はこのフォルダを開くと `AGENTS.md` を自動で読みます。

## 入っているもの
| ファイル | 中身 |
|---|---|
| `AGENTS.md` | Codex への指示（ルール・全体構成・作るファイル・構築の段階と完了条件） |
| `docs/SPEC.md` | 詳細仕様（Drive の構成、識別子、処理の順番、Notion・Chatwork の書き込み、台帳の列、画面の項目） |
| `prompts/chatgpt_scheduled_task.md` | ChatGPT の予約タスクに貼る指示文 |
| `schemas/inbox_judgement.schema.json` | ChatGPT が出す判定 JSON の形（検証済み） |
| `config/script_properties.md` | GAS に登録する設定のキー一覧（値は書かない） |
| `fixtures/` | 動作確認用のサンプル（判定 JSON 3件、manifest、マスタ、tl;dv 受信ページ） |

## Codex に渡す前に用意するもの
1. Windows の PC に Node.js（LTS）を入れる。Codex から `npm i -g @google/clasp` を実行できる状態にする。
2. `clasp login` は **finance@premiere-mode.co.jp** で行う（ユーザー指定のGAS所有アカウント）。
3. 開発用の環境：
   - 共有ドライブ「MTG記録」の中に `_system/_test/`（00_受信・inbox・ref）
   - Notion のテスト用 DB（MTG議事録・プロジェクト・タスクを複製したもの）と「tl;dv 受信」DB
   - Chatwork のテスト用ルーム
4. Notion の内部インテグレーション（contact@ が作成）と Chatwork の API トークン。値は Codex に渡さず、GAS のスクリプト プロパティに人が入力する。

## Codex への最初の依頼（例）
```
このフォルダの AGENTS.md と docs/SPEC.md を読んで、理解した構成と段階0でやることを報告してください。報告を確認したら段階0を始めてもらいます。
```

## 注意
- 開発中は `DRY_RUN=true`、テスト用の DB・ルーム・フォルダだけを使います。本番への切り替えは福本さん・川戸さんの承認後です。
- 「要決定」の項目（確認者、2DB、依頼者・担当者、MTG URL、Chatwork の投稿アカウント、閲覧ランク）は、決まったら `docs/SPEC.md` を更新して Codex に伝えてください。

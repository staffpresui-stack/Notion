# AGENTS.md — MTG議事録自動化（プレミアモード株式会社）

このリポジトリは、プレミアモード株式会社の会議の録画・文字起こしから議事録を作り、Google ドライブと Notion に格納し、Chatwork と確認画面で人が確認・修正できるようにする仕組みを Google Apps Script（GAS）で構築するためのものです。
あなた（Codex）はこのファイルと `docs/` を読み、下の「構築の段階」に沿って実装・検証を進めてください。

- 設計の原本（人向け・図あり）：MTG議事録自動化 設計 v0.2（2026-10-20）
- 詳細仕様：`docs/SPEC.md`（本ファイルと食い違う場合は SPEC.md を優先し、食い違いを報告する）
- ChatGPT の予約タスクに貼る指示文：`prompts/chatgpt_scheduled_task.md`
- 判定 JSON のスキーマ：`schemas/inbox_judgement.schema.json`
- 動作確認用のサンプル：`fixtures/`
- 設定キーの一覧：`config/script_properties.md`

---

## 最新のユーザー指定（元の設計より優先）

- 最新の依頼で段階2のingestInbox実装を許可。ENV=testに限りstaff.presuiのマイドライブ専用テストフォルダ・テスト台帳を使用可能（SHARED_DRIVE_IDなし可）。準備・サンプル投入・テスト取り込みはユーザーがGASでDRY_RUN=falseにして実行し、Codexは実行しない。Chatwork未設定時はログとdry_run_logだけ。手順は `docs/INGEST_INBOX_TEST.md`。以下の古いマイドライブ禁止・Drive書き込み禁止という記述より今回のテスト限定指定を優先する。本番書き込みは引き続き禁止。

- テストDB初期作成はユーザー側で成功報告済み。今回の接続確認とNotionサンプル検証の手順は `docs/NOTION_FIXTURE_TEST.md`。`ingestFixturesToNotionTest()` に限り、ENV=test、確認済みテストID、DRY_RUN=falseでサンプルページ作成を許可する。GAS実行・実Notion書き込みはユーザーが行う。Drive・Chatwork・タスク提案の書き込みは禁止。通常処理のDRY_RUN制約は維持する。

- ユーザーがテストDB初期作成関数の実装を明示依頼済み。`setupTestDatabases()` は `ENV=test` と `SETUP_CREATE_TEST_DB=true` で管理ページ下への初期作成を許可する専用機能です。この関数はDRY_RUN=trueでもテストDBを実作成します。GAS実行とNotionへの書き込みはユーザーが行います。Codex側では実行しません。通常処理のDRY_RUN制約は維持します。手順は `docs/SETUP_TEST_DATABASES.md`。

- GAS-A・GAS-Bの作成・所有・clasp認証は `staff.presui@gmail.com` を使います。Notion・ChatGPT・tl;dv・Chatworkのアカウント変更は指示されていません。
- 個人Gmailには会社ドメイン限定公開を適用できないため、現時点ではWebアプリを公開しません。共有ドライブへのアクセス権も別途検証します。権限がない場合に無断で個人Driveへ保存先を変えないでください。
- 以下のcontact@所有という記載は元の設計です。GASの所有者・実行用アカウントに関しては今回の指定を優先します。GAS-Bの実行権限は引き続き各会議主催者です。

## 1. 最初に読む順番

1. このファイル（全体・ルール・段階）
2. `docs/SPEC.md`（データ・処理・画面の仕様）
3. `schemas/inbox_judgement.schema.json` と `fixtures/`
4. `prompts/chatgpt_scheduled_task.md`（GAS とやり取りする相手の仕様）

読み終えたら、実装に入る前に「理解した構成」と「段階1でやること」を短く報告してから始めてください。

---

## 2. 厳守ルール

### 2-1. 秘密情報
- API トークン・パスワード・2段階認証のコードを、コード・コミット・ログ・Chatwork・Notion に書かない。
- 秘密値は GAS の **スクリプト プロパティ**だけに置く（キー名は `config/script_properties.md`）。リポジトリには `.example` やキー名だけを置く。
- `.clasp.json`・`.clasprc.json`・認証情報のファイルは `.gitignore` に入れる。

### 2-2. 本番データへの書き込み
- 開発中は必ず `DRY_RUN=true` で動かす。DRY_RUN 中は Notion・Chatwork・Drive への書き込みを行わず、「何をするはずだったか」を台帳の `dry_run_log` シートに書く。
- Chatwork は開発中は **テスト用ルーム**（`CHATWORK_ROOM_ID_TEST`）にだけ投稿する。本番ルーム（`CHATWORK_ROOM_ID`）への切り替えは人の承認後。
- Notion は開発中、本番の「MTG議事録」「プロジェクト・タスク」DB に書かない。テスト用 DB（`NOTION_DB_MINUTES_TEST` など）を使う。
- Drive は開発中、共有ドライブ「MTG記録」の中の `_system/_test/` 配下だけを使う。
- **ファイルやページを削除しない。** 不要になったものは `99_対象外/` へ移動、Notion はアーカイブ（`archived: true`）まで。完全削除はしない。
- 本番に切り替える前に、人（福本さん・川戸さん）の承認を取る。承認なしに `DRY_RUN=false` や本番 ID に切り替えない。

### 2-3. 分からないとき
- SPEC.md に「要決定」「要確認」とある項目は、勝手に決めずに **設定値（スクリプト プロパティ or `settings` シート）で切り替えられる形**で実装し、既定値と理由をコメントに書く。
- API の挙動が SPEC と違う・権限で止まる場合は、回避策を勝手に足さず、事実（エラー全文の要約・再現手順）を報告して止まる。
- 外部 API の仕様は、実装前に公式ドキュメントで確認する（Notion API、Chatwork API v2、Google Apps Script、Google Drive API v3、Google Calendar API v3）。

### 2-4. 書き方
- 画面・通知・ログの文言は日本語。です・ます調の短い文。英語の見出しや絵文字は使わない。
- 画面の項目名・状態名は SPEC.md の表記を使う（勝手に言い換えない）。
- コードのコメントは日本語でよい。関数名・変数名は英語。

---

## 3. 全体構成（要約）

```
[Google Calendar + Meet]  予定ごとに「会議の記録」（録画・文字起こし・Geminiメモ）をオン
        │ 会議後、主催者のマイドライブ「Google Meet」/〈会議〉/ に保存、予定にも添付
        ▼
[GAS-B 主催者用（主催者ごとのトリガー）]  ファイルを共有ドライブ _system/00_受信/{key}/ へ移動
        │                                       ＋ manifest.json を作成
[tl;dv（補助・無料）] → Notion 連携 → [Notion 受信DB「tl;dv 受信」]
        │                                       │
        │                       [GAS-A] が query → Meet と照合 → Meet が無ければ 00_受信/{key}/ に Doc 化
        ▼
[ChatGPT Plus 予約タスク（Cloud）]  00_受信 を読み、議事録 Doc と判定 JSON を _system/inbox/ に置く
        │                     （代替：GAS-A が OpenAI API を直接呼ぶ GENERATOR_MODE=OPENAI_API）
        ▼
[GAS-A 本体（contact@ 所有）]
   inbox 取り込み → 台帳（スプレッドシート）→ 会議フォルダ作成・配置
   → Notion（MTG議事録）作成 → Chatwork に確認カード投稿（message_id 保存）
        ▼
[確認・編集画面（GAS-A の Web アプリ、ドメイン限定）]
   このまま確定／修正して確定／保留／対象外 → フォルダ移動・Notion 更新・Chatwork カード書き換え・変更ログ
   タブ2：タスク提案の承認 → Notion プロジェクト・タスクへ反映（取り消し可）
```

- **GAS-A（本体）**：`contact@premiere-mode.co.jp`（以下 contact@）が所有。取り込み・配置・Notion・Chatwork・台帳・確認画面・朝の一覧・停止検知。
- **GAS-B（主催者用）**：別の GAS プロジェクト。Web アプリを「アクセスしているユーザーとして実行」で公開し、主催者が一度「登録」を押すと、その主催者の権限で動く時間主導トリガーを作る。Meet のファイルは主催者が所有しているため、移動は主催者の権限で行う必要がある。
- **状態の正本は台帳スプレッドシート**。Chatwork と Notion は写し。

---

## 4. リポジトリ構成（作るもの）

```
/AGENTS.md
/docs/SPEC.md
/prompts/chatgpt_scheduled_task.md
/schemas/inbox_judgement.schema.json
/config/script_properties.md
/fixtures/                      … サンプルの判定 JSON・manifest・tl;dv 受信ページ
/gas-core/                      … GAS-A（clasp プロジェクト）
   appsscript.json
   src/config.js                … 設定の読み込み・検証（checkConfig）
   src/ledger.js                … 台帳シートの読み書き・ロック・版番号
   src/driveUtil.js             … 共有ドライブ操作（Advanced Drive v3）
   src/notionClient.js          … Notion API（UrlFetchApp）
   src/chatworkClient.js        … Chatwork API v2
   src/ingestTldv.js            … 受信DB の取り込み・Meet 照合
   src/ingestInbox.js           … inbox の取り込み・判定・配置・Notion 作成・通知
   src/generatorOpenAI.js       … GENERATOR_MODE=OPENAI_API のときの議事録生成（代替）
   src/review.js                … 確認画面のサーバー処理（確定・修正・保留・対象外・再実行）
   src/tasks.js                 … タスク提案の承認・反映・取り消し（段階5）
   src/digest.js                … 朝の一覧カード・停止検知
   src/triggers.js              … 時間主導トリガーの作成・削除
   src/setup.js                 … 初期化（シート作成・フォルダ ID 登録・スキーマ取得）
   src/ui/Index.html, Detail.html, Tasks.html, styles.html, scripts.html
/gas-organizer/                 … GAS-B（clasp プロジェクト）
   appsscript.json
   src/register.js              … 登録画面（doGet）・トリガー作成
   src/mover.js                 … 終了済み予定の添付 → 00_受信 へ移動・manifest 作成
   src/ui/Register.html
/tests/                         … ローカルで動く純粋関数のテスト（Node）
```

- デプロイは `clasp`（Node.js）で行う。Windows では `npm i -g @google/clasp` → `clasp login`（**contact@ でログイン**。GAS-B の作成も contact@）。
- clasp が使えない場合は、Apps Script エディタに手で貼る手順を `docs/DEPLOY.md` に書いて残す。
- GAS は V8 ランタイム。ES モジュールは使えないので、ファイルはグローバル関数で書き、名前の衝突に注意する（`Ledger_`, `Notion_` のように接頭辞をつける）。
- 純粋関数（照合・判定・JSON 検証・Chatwork 文面の組み立て・Notion ブロック変換）は `tests/` で Node から単体テストできるように、GAS 固有の API に依存しない形で分ける。

---

## 5. 構築の段階（順番に進める。各段階の完了条件を満たしたら報告して次へ）

### 段階0：準備と読み取り確認（書き込みなし）
- `gas-core` と `gas-organizer` を作成し、`appsscript.json` に必要なスコープと Advanced Services（Drive v3、Calendar v3）を設定。
- `config.js` の `checkConfig()`：必要なスクリプト プロパティがそろっているかを検査し、不足を一覧で返す。
- `setup.js` の `dumpNotionSchemas()`：MTG議事録・プロジェクト・タスク・tl;dv 受信の各 DB のプロパティ名と型を取得してログに出す（**読み取りのみ**）。SPEC のプロパティ名と違えば報告する。
- `setup.js` の `initLedger()`：台帳スプレッドシートに SPEC のシートと見出し行を作る。
- `setup.js` の `registerFolders()`：共有ドライブ「MTG記録」のフォルダ ID を `masters_folders` に登録する（名前は完全一致で探す）。
- **完了条件**：`checkConfig()` が不足なし、`dumpNotionSchemas()` の結果を報告、台帳とフォルダ ID の登録ができた。

### 段階1：主催者用 GAS（GAS-B）
- 登録画面（「この PC のアカウントで登録」ボタン、登録済みかの表示、解除ボタン）。
- 登録すると、そのユーザーの時間主導トリガー（15分ごと・`MOVER_INTERVAL_MIN`）を作る。二重登録しない。
- `mover`：終了から `MOVER_WAIT_MIN`（既定20分）以上たった自分主催の予定を Calendar API で取得し、`attachments` の fileId（録画・文字起こし・Gemini メモ）を `_system/00_受信/{folder_key}/` へ移動。`manifest.json` を作る。処理済みの予定は再処理しない（ファイルの `appProperties.meeting_key` と 00_受信 の存在で判定）。
- **完了条件**：テスト予定1件で、3ファイルが `_system/_test/00_受信/{folder_key}/` に移動し、manifest が SPEC どおり。予定の添付から開けるかを確認して報告。

### 段階2：取り込み・配置・Notion・Chatwork（GAS-A）
- `ingestInbox`：`_system/inbox/` の判定 JSON をスキーマ検証 → 規則での判定と突き合わせ → 台帳に行を追加 → 会議フォルダ作成 → 配置（確信度・機密・食い違いのルールは SPEC）→ Notion に MTG議事録ページ作成 → Chatwork に確認カード投稿 → message_id を保存 → JSON を `inbox/_done/` へ移動。
- 1回の実行で処理する件数は `INGEST_BATCH`（既定5）まで。`LockService` で多重実行を防ぐ。
- Notion が 403（ブロック上限など）を返したら `notion_status=Notion保留` にして先へ進む（全体を止めない）。
- **完了条件**：`fixtures/` の判定 JSON 3件（社内・高／社外・高／社外・低）を DRY_RUN と テスト環境の両方で通し、台帳・フォルダ・テスト DB・テストルームの結果を報告。

### 段階3：確認・編集画面（タブ1）
- 一覧・詳細・編集・ボタン（このまま確定／修正して確定／保留／対象外／再実行）。
- 確定時の反映：差分があれば会議フォルダを1回移動 → Notion のプロパティ更新 → Chatwork の同じメッセージを PUT で書き換え → `change_log` に追記。確定後の再修正は、書き換えに加えて `[rp]` 返信で変更点を残す。
- 同時編集は `version` 列で検知し、「先に更新されました。画面を読み込み直してください。」と出す。
- **完了条件**：fixtures の3件で、確定・修正・保留・対象外・再実行の各操作が台帳・Drive・Notion・Chatwork に正しく反映される。

### 段階4：tl;dv 経路
- `ingestTldv`：受信DB の `取り込み状態=未処理` を取得 → 会議終了から `TLDV_WAIT_MIN`（既定60分）待つ → 台帳の Meet 行と照合（SPEC の照合ルール）→ Meet があれば `対象外（Meet優先）`、無ければトランスクリプトを Google ドキュメントにして `00_受信/{folder_key}/` に置き、manifest を作り `取り込み済み` にする。
- tl;dv を先に取り込んだ後で Meet が届いた場合も、tl;dv 側を `対象外（Meet優先）` にして、台帳・Notion・Chatwork を書き換える。
- **完了条件**：fixtures の受信ページ（Meet あり／なし）で期待どおりになる。

### 段階5：タスク提案（タブ2）・朝の一覧・停止検知
- タスク提案の承認・却下・保留・内容修正、Notion への反映、取り消し（SPEC の取り消し表）。
- 反映の直前に Notion の現在値を読み直し、提案時から変わっていれば止めて警告。
- 朝の一覧カード（毎朝9時・`DIGEST_HOUR`）を1枚投稿し、その日のうちは書き換えて更新。
- 停止検知：00_受信 に入ってから `GENERATOR_TIMEOUT_MIN`（既定180分）たっても inbox に判定が来ない会議があれば管理者にメンション。tl;dv の残りトリガーが `TLDV_REMAINING_ALERT`（既定5）以下になったら通知。
- **完了条件**：テスト環境で一連の動作を確認し報告。

### 段階6：本番切り替え（人の承認後）
- `DRY_RUN=false`、本番の DB・ルーム・フォルダに切り替え。2週間は並行運用し、自動の判定と確定値の差（的中率）を台帳から集計できる関数 `accuracyReport()` を用意する。

---

## 6. 報告の書き方
- 各段階の終わりに：やったこと／完了条件の結果（成功・失敗）／未確認の点／次にやること／人に決めてほしいこと。
- エラーは、どの API・どの操作・HTTP ステータス・エラーメッセージの要約・再現手順を書く。トークンは書かない。

## 7. 人に確認が必要な事項（未決。実装は設定で切り替えられるようにしておく）
- 議事録の確認者（仮：会議の主催者。仕分け待ちは管理者）
- タスクの DB を「プロジェクト／非プロジェクト」の2つにするか（`TASK_DB_MODE`）
- 依頼者・担当者プロパティの型と運用
- Notion の「事業部全体」に当たる選択肢（「全社共通」を追加するか）
- MTG議事録の「MTG URL」に入れる値（会議フォルダの URL か Meet の URL か。`NOTION_MTG_URL_SOURCE`）
- Chatwork の投稿アカウント（contact@ の Chatwork か Bot 用か）
- 共有ドライブ内の閲覧権限のランク（`_system`・`社内/経営` のアクセス制限の方法）
- 議事録生成を ChatGPT 予約タスクで続けるか、OpenAI API に切り替えるか（`GENERATOR_MODE`）

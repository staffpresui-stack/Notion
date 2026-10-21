# SPEC.md — MTG議事録自動化 詳細仕様（v0.2・2026-10-21）

「（仮）」は既定値で、設定で変えられるようにする。「要決定」「要確認」は人の判断・実機確認が必要な項目。

---

## ユーザー指定による変更

GAS-A・GAS-Bの所有者・作成・認証用アカウントは `staff.presui@gmail.com` に変更します（2026-10-21）。以下のcontact@所有・実行という記述より優先します。GAS-Bのファイル移動は引き続き各会議主催者の権限です。Notion等の他サービスのアカウントは変更しません。

個人Gmailのため、元設計の `access: DOMAIN` と会社ドメイン付きURLはそのまま使用できません。現在はWebアプリを公開せず、将来の公開方式と操作者識別を実機確認します。共有ドライブへの外部アカウント権限も未確認です。

## 1. 前提と範囲

| 項目 | 内容 |
|---|---|
| 会社 | プレミアモード株式会社。社員は全員 Windows。Google Workspace Business Standard（ドメイン `premiere-mode.co.jp`）。チャットは Chatwork |
| 主の経路 | 自社が Meet リンクを発行する会議（社外参加者を含む）。予定ごとに主催者が「会議の記録」（録画・文字起こし・Gemini メモ）をオンにする |
| 補助の経路 | 相手主催など Meet で記録できない会議。tl;dv（会社で1アカウント・無料）。Notion のネイティブ連携で受信DB に入る。無料のワークフロートリガーは生涯20回（2026-10-19 時点で残り17） |
| 重複 | 同じ会議に Meet と tl;dv の両方がある場合は Meet を使い、tl;dv 側は「対象外（Meet優先）」 |
| 議事録の生成 | ChatGPT Plus の予約タスク（Cloud 実行）。代替として GAS から OpenAI API を呼ぶモードも実装する（`GENERATOR_MODE`） |
| 書き込みの担当 | Notion・フォルダ移動・Chatwork・台帳は GAS-A（contact@）。Meet ファイルの最初の移動だけ GAS-B（主催者の権限） |
| 対象外 | 録画の動画を tl;dv から取り込むこと（無料ではダウンロード不可）。川戸さんのワークスペースへの書き込み |

---

## 2. アカウントと権限

| 主体 | 役割 |
|---|---|
| contact@ | GAS-A と GAS-B の所有者。共有ドライブ「MTG記録」のコンテンツ管理者。Notion ワークスペースの唯一のメンバー（オーナー）で、内部インテグレーションを作成。ChatGPT Plus（予約タスクの作成者。ログインが contact@ かは要確認）。tl;dv 会社アカウント（要確認） |
| 会議の主催者 | Meet ファイルの所有者。GAS-B で一度「登録」し、自分の時間主導トリガーを許可する。共有ドライブで `_system/00_受信` に書き込める権限（投稿者以上）が必要（要確認：`_system` をアクセス制限した場合の付与方法） |
| 確認者 | 確認画面で確定・修正する人（仮：会議の主催者。仕分け待ちは管理者） |
| 管理者 | 福本さんほか。停止・エラーの通知先。マスタの編集 |
| 社員 | Notion のゲスト（最大10人）。API のユーザー一覧には出ない |

---

## 3. 識別子

| 名前 | 形式 | 説明 |
|---|---|---|
| `meeting_key` | `meet:{calendarEventId}` / `tldv:{meetingId}` | 会議の一意キー。定期予定は回ごとの eventId（`{id}_{yyyyMMddTHHmmssZ}`）。tl;dv の meetingId は会議URL から取る。取れなければ `tldv:notion-{受信ページID}`（要確認） |
| `folder_key` | `meeting_key` の `:` を `_` に置換 | Drive のフォルダ名・ファイル名に使う（Windows の同期で `:` が使えないため） |
| `display_id` | `MTG-YYMMDD-NN` | 人が読む番号。開催日ごとに連番 |
| `placement` | `社内/{部署}` / `社外/{顧客名}` | 格納先。判定 JSON と台帳で使う。`masters_folders.placement` と `masters_clients.client_name` に対応 |

---

## 4. Google ドライブ

### 4-1. 共有ドライブ「MTG記録」
```
MTG記録/
  社内/ 事業部全体・セールス・マーケ・EC・生産管理・経理・バックオフィス・Salesforce・AI・経営
  社外/ {顧客名}/            … masters_clients に登録したものだけ。自動では作らない
  00_仕分け待ち/
  99_対象外/
  _system/
    00_受信/{folder_key}/    … 生データ（録画・文字起こし・Gemini メモ or tl;dv 文字起こし Doc）＋ manifest.json
    inbox/                   … ChatGPT が置く {folder_key}.json と議事録 Doc
    inbox/_done/             … 取り込み済みの JSON
    ref/                     … projects.json / masters.json（GAS-A が毎朝出力）
    _test/                   … 開発用（同じ構成をこの下に作る）
    台帳（スプレッドシート「MTG議事録 台帳」）
```
- フォルダ名の「/」は「・」。Drive と Notion の対応は名前ではなく `masters_folders` のフォルダ ID で持つ。
- 会議フォルダ：`YYYY-MM-DD_HHmm_会議名`（会議名の禁止文字 `\/:*?"<>|` は全角に置換、40文字で切る）。中に議事録 Doc・文字起こし・Gemini メモ・録画 MP4 を入れる。1会議＝1フォルダ。
- 生データは配置のときに `00_受信/{folder_key}/` から会議フォルダへ**移動**する（コピーしない）。空になった受信フォルダは `99_対象外/_空/` へ移動（削除しない）。

### 4-2. Drive 操作の約束
- Advanced Drive Service v3 を使い、すべての呼び出しに `supportsAllDrives: true`。
- 移動は `Drive.Files.update({}, fileId, null, {addParents, removeParents, supportsAllDrives:true})`。
- ファイルに `appProperties`（`meeting_key`, `kind`=recording|transcript|gemini|minutes|tldv_transcript）を付ける。
- 共有ドライブ内でフォルダを移動できるのはコンテンツ管理者以上（contact@ は可）。

---

## 5. GAS-B（主催者用）

- Web アプリ（`executeAs: USER_ACCESSING`, `access: DOMAIN`）。画面：登録状態、［この PC のアカウントで登録］［登録を解除］。
- 登録：`ScriptApp.newTrigger('moverRun').timeBased().everyMinutes(15)`（`MOVER_INTERVAL_MIN`）。同じユーザーの既存トリガーがあれば作らない。GAS-A の台帳 `organizers` シートに登録状況を書く（GAS-B から台帳へ書く権限が必要。無理なら GAS-A の Web アプリの `doPost` に登録情報を送る。要確認）。
- `moverRun`：
  1. Calendar Advanced Service `Calendar.Events.list('primary', {timeMin: 現在-48時間, timeMax: 現在-MOVER_WAIT_MIN, singleEvents:true, supportsAttachments:true})`。
  2. 自分が主催者（`organizer.self == true`）で `conferenceData` が Meet、`attachments` がある予定だけ。
  3. 添付の `fileId` ごとに、MIME とファイル名から kind を判定（動画＝recording、文書で「文字起こし」「Transcript」＝transcript、「Gemini」「メモ」＝gemini）。判定できないものは移動せずログ。
  4. `_system/00_受信/{folder_key}/` を作成（既にあれば使う）し、ファイルを移動。`appProperties` を付ける。
  5. `manifest.json` を作る（下記）。全ファイル移動後に `status: "ready"`。
  6. 録画の処理が終わっていない（添付がまだ揃わない）予定は次回に回す。予定終了から48時間たっても揃わなければ、揃った分だけで `ready` にし `missing` に残りを書く。
- manifest.json：
```json
{
  "meeting_key": "meet:abc123_20261021T020000Z",
  "source": "meet",
  "event_id": "abc123_20261021T020000Z",
  "title": "△△様 定例",
  "start": "2026-10-21T11:00:00+09:00",
  "end": "2026-10-21T12:00:00+09:00",
  "organizer_email": "fukumoto@premiere-mode.co.jp",
  "attendees": [{"email": "sato@premiere-mode.co.jp", "name": "佐藤"}, {"email": "taro@example.co.jp", "name": "山田"}],
  "meet_url": "https://meet.google.com/xxx-xxxx-xxx",
  "files": {"recording": "fileId", "transcript": "fileId", "gemini": "fileId"},
  "missing": [],
  "status": "ready",
  "created_at": "2026-10-21T12:25:00+09:00"
}
```

---

## 6. tl;dv 経路（GAS-A `ingestTldv`、10分ごと・仮）

- Notion 受信DB「tl;dv 受信」（contact@ が作成）。tl;dv の連携で送られる項目：タイトル・AIメモ・トランスクリプト・参加者・日付・会議URL・長さ。GAS 用に「取り込み状態」（select：未処理／取り込み済み／対象外（Meet優先）／エラー）と「meeting_key」（text）を持つ。トランスクリプトがプロパティか本文ブロックかは要確認（両方に対応する）。
- 処理：
  1. `取り込み状態` が空または「未処理」のページを query。
  2. 日付＋長さから会議終了時刻を出し、`TLDV_WAIT_MIN`（60分・仮）たっていなければ次回へ。
  3. Meet 照合：台帳 `minutes` と 00_受信 の manifest に、開始時刻が ±`MATCH_WINDOW_MIN`（15分）以内、かつ正規化タイトル（空白・記号を除き、全角半角をそろえ、小文字化）が一致する Meet の会議があれば「対象外（Meet優先）」にして終了。タイトルが空なら時刻と参加者のメールが2人以上一致で同一とみなす。
  4. 無ければ、トランスクリプト（＋AIメモを末尾に「参考：tl;dv の AI メモ」として）を Google ドキュメントにして `00_受信/{folder_key}/` に置き、manifest（`source: "tldv"`, `files.tldv_transcript`）を作り、「取り込み済み」にする。
  5. 逆順のケース：tl;dv を取り込んだ後に同じ会議の Meet が 00_受信 に来たら、tl;dv 側の台帳行を `対象外（Meet優先）` にし、会議フォルダを `99_対象外/` へ、Notion ページをアーカイブ、Chatwork カードを【対象外（Meet優先）】に書き換える。
- 残り回数：`settings.tldv_remaining_base`（初期値17）から、取り込んだページ数を引いて推定。`TLDV_REMAINING_ALERT`（5）以下で管理者に通知。

---

## 7. 議事録の生成

### 7-1. ChatGPT 予約タスク（`GENERATOR_MODE=CHATGPT`、既定）
- ChatGPT は `00_受信/*/manifest.json` のうち `status: "ready"` で、`inbox/{folder_key}.json` も `inbox/_done/{folder_key}.json` も無いものを処理する。
- 出力：`inbox/{folder_key}_議事録`（Google ドキュメント）と `inbox/{folder_key}.json`（`schemas/inbox_judgement.schema.json` に従う）。指示文は `prompts/chatgpt_scheduled_task.md`。
- 判定 JSON が書けない場合（Drive への書き込み不可・承認待ち）は、実機検証の結果で `GENERATOR_MODE=OPENAI_API` に切り替える。

### 7-2. OpenAI API（`GENERATOR_MODE=OPENAI_API`、代替）
- GAS-A が 00_受信 の ready を拾い、文字起こし（Doc のテキスト）と manifest、`ref/*.json` を入力に、OpenAI の Responses API を呼ぶ。指示文は `prompts/chatgpt_scheduled_task.md` の本文を流用し、出力は JSON Schema 指定（structured output）で判定 JSON＋議事録本文を受け取る。
- モデル名は `OPENAI_MODEL`（スクリプト プロパティ）で指定。API キーは `OPENAI_API_KEY`。
- 文字起こしが長い場合は、先頭から順に分割して要約→統合の2段にする（1回の GAS 実行6分以内に収める。収まらなければ次回に続きを処理できるよう途中結果を `_system/inbox/_work/` に保存）。

---

## 8. 取り込みと配置（GAS-A `ingestInbox`、10分ごと・仮）

1. `inbox/*.json` を古い順に最大 `INGEST_BATCH` 件。スキーマ検証に失敗したら `status=要対応`、`last_error` に理由。
2. 規則による判定（GAS が計算）：
   - 社内／社外：参加者全員が `masters_internal`（メールかドメイン）に含まれれば社内、それ以外は社外。
   - 顧客：社外参加者のドメインが `masters_clients.domains` と**完全一致**した顧客。フリーメール（`FREE_MAIL_DOMAINS`：gmail.com, yahoo.co.jp, outlook.jp, icloud.com など）は判定に使わない。
3. ChatGPT の判定と規則の突き合わせ：
   - 規則で社外なのに ChatGPT が社内 → 食い違い。
   - 規則で顧客が決まったのに ChatGPT の `placement` の顧客名が違う → 食い違い。
   - ChatGPT の `placement` が `masters_folders`／`masters_clients` に無い → 食い違い（顧客の新規作成は人だけ）。
   - `domains` に6択以外の値 → その値を捨てて `last_error` に記録。
4. 自動配置の条件：`confidence == "高"` かつ `sensitive == false` かつ 食い違いなし → 判定先へ配置し `status=確認待ち`。それ以外 → `00_仕分け待ち/` に配置し `status=仕分け待ち`。
5. 会議フォルダを作り、00_受信 のファイルと inbox の議事録 Doc を移動。
6. Notion の MTG議事録にページを作成（9章）。403 などで失敗したら `notion_status=Notion保留`（または `エラー`）にして続行。
7. Chatwork にカードを投稿（10章）、`chatwork_message_id` を保存。
8. JSON を `inbox/_done/` へ移動。`change_log` に `kind=取り込み` を追記。
- 冪等性：`meeting_key` が台帳にあれば新規作成しない（再実行は「再実行」ボタン経由）。各段階の完了を台帳の列で持ち、途中で落ちても続きから再開できるようにする。

---

## 9. Notion

### 9-1. 接続
- 内部インテグレーション（contact@ が作成）。トークンは `NOTION_TOKEN`。API バージョンは `NOTION_VERSION`（実装時に公式ドキュメントで最新の安定版を確認し、データソース API が必要なら対応する）。
- 対象 DB（本番）：MTG議事録 `4cf02dee-7a11-4319-ace1-e866d6a1a914`、プロジェクト・タスク `e321f1cb-3365-4a2c-9844-47f34734a9d7`、tl;dv 受信（ID は作成後に設定）。開発中はテスト用 DB を使う。
- プロパティ名と型は**実装前に `dumpNotionSchemas()` で取得して確認**する。下表は 2026-10-14 時点の想定。

### 9-2. MTG議事録の書き込み
| プロパティ | 型（想定） | 入れる値 |
|---|---|---|
| 議事録名 | title | `minutes_title`（`YYYY-MM-DD 会議名`） |
| 日付 | date | 開催開始（日時） |
| 参加者 | people | `masters_people` で Notion ユーザー ID が分かる人だけ（ゲストを指定できるかは要確認。できなければ空のまま、本文の基本情報に名前を書く） |
| MTG URL | url | `NOTION_MTG_URL_SOURCE`（`folder`＝会議フォルダの URL／`meet`＝Meet の URL／`none`。要決定。既定 `none`） |
| 事業部領域 | multi_select | `domains_final`（6択の完全一致名だけ。新しい選択肢を作らない） |
| 関連するプロジェクト | relation | `related_project_ids_final` |
- 本文：議事録 Doc の内容をブロックに変換（見出し2・見出し3・段落・箇条書き・番号付き・表）。1回の追加は100ブロックまで、rich_text は1要素2000文字まで。録画・Drive・tl;dv のリンクは本文に入れない。
- 確定後の修正は `PATCH /v1/pages/{id}` でプロパティだけ更新。対象外にしたら `archived: true`。

### 9-3. プロジェクト・タスクへの反映（段階5）
| プロパティ | 型（想定） | 備考 |
|---|---|---|
| プロジェクト/タスク名 | title | |
| ステータス | status または select | 未着手／保留／進行中／対応不要／完了 |
| 期日 | date | |
| 担当者 | people | `masters_people` で ID が分かる場合のみ。分からなければ 備考 に「担当：○○」 |
| 備考 | rich_text | |
| 完了条件 | rich_text | |
| 事業部領域 | multi_select | |
| 関連するMTG | relation | 議事録ページ |
| 親アイテム | relation | プロジェクトの下に作る場合 |
| 依頼者 | 要決定 | 10/21 に決める |
- `TASK_DB_MODE`：`single`（プロジェクト・タスクのみ）／`dual`（プロジェクトと非プロジェクトの2DB。非プロジェクト DB の ID は `NOTION_DB_NONPROJECT`）。要決定。既定 `single`。

---

## 10. Chatwork

- API v2。`POST /v2/rooms/{room_id}/messages`（body, form 形式）、`PUT /v2/rooms/{room_id}/messages/{message_id}`。ヘッダー `X-ChatWorkToken`。自分が投稿したメッセージだけ編集できる。
- 1議事録＝1メッセージ。状態が変わるたびに同じメッセージを書き換える。確定後の再修正は書き換え＋`[rp aid={account_id} to={room_id}-{message_id}]` 返信で変更点を残す。
- **録画・Drive のリンクは載せない**（社内ルール）。載せるのは確認画面のリンクだけ。開いただけで状態が変わるリンクは作らない。
- 宛先 `[To:{account_id}]` は確認者（`masters_people.chatwork_account_id`）。分からなければ宛先なし。
- 文面（投稿時）：
```
[To:{account_id}]{氏名}さん
[info][title]【確認待ち】議事録の格納先を確認してください（{display_id}）[/title]
{M/D(曜)} {HH:mm}–{HH:mm}　{会議名}（{Meet|tl;dv}・主催 {主催者名}）
[hr]Drive：{社内|社外} ＞ {部署|顧客}（自動配置済み）
Notion：MTG議事録「{議事録名}」（{作成済み|作成待ち}）
事業部領域：{…}／関連PJ：{…}
根拠：{reason}（確信度 {高|中|低}）
[hr]タスク提案：新規{n}・更新{n}（未承認）
確認・修正：[url]{WEBAPP_URL}?id={display_id}[/url][/info]
```
- 状態ごとのタイトル：

| status | タイトル | 催促（仮） |
|---|---|---|
| 確認待ち | 【確認待ち】 | 朝の一覧に載せる。2営業日でメンション |
| 仕分け待ち | 【格納先を選んでください】 | 翌営業日にメンション |
| 確定／確定・修正あり | 【確定】／【確定・修正あり】 | なし |
| 保留／対象外 | 【保留】／【対象外】 | 保留は週1回一覧に載せる |
| 対象外（Meet優先） | 【対象外（Meet優先）】（投稿済みの場合のみ書き換え） | なし |
| 要対応 | 【要対応】 | 管理者にメンション |
- 朝の一覧（`DIGEST_HOUR` 時・既定9）：1枚投稿し、その日のうちは書き換え。例「10/21分 6件：確定4／確認待ち1／仕分け待ち1、タスク提案：承認5・却下1、要対応0」。
- 開発中は `CHATWORK_ROOM_ID_TEST` にのみ投稿。

---

## 11. 台帳（スプレッドシート「MTG議事録 台帳」）

1行目は見出し。列の順番は下のとおり。日時は ISO 8601（+09:00）、配列は JSON 文字列。

**minutes**：`meeting_key, display_id, source, event_id, event_start, event_end, title, organizer_email, attendees_json, scope_auto, scope_final, placement_auto, placement_final, folder_id_final, domains_auto, domains_final, related_project_ids_auto, related_project_ids_final, minutes_title, minutes_doc_id, raw_file_ids_json, meeting_folder_id, confidence, reason, sensitive, conflict, status, notion_page_id, notion_status, chatwork_message_id, reviewer_email, version, created_at, updated_at, confirmed_by, confirmed_at, step_done_json, last_error`

**task_proposals**：`proposal_id, meeting_key, seq, type, task_db, target_notion_id, title, before_json, after_json, requester_email, assignee_email, evidence, decision, decided_by, decided_at, applied_at, result, applied_page_id, applied_block_ids_json`

**change_log**（追記のみ）：`change_id, at, meeting_key, kind, target, before_json, after_json, actor, result, revert_of`

**masters_folders**：`placement, drive_folder_id, notion_domain, rank`（rank＝閲覧ランク、要決定）

**masters_clients**：`client_name, domains, drive_folder_id, created_by, created_at`

**masters_internal**：`email_or_domain, note`（`premiere-mode.co.jp` と、社員が使う個人の gmail など）

**masters_people**：`name, google_email, alt_emails, notion_user_id, chatwork_account_id, domains, is_reviewer, is_admin`

**organizers**：`email, registered_at, trigger_id, last_run_at, last_result`

**settings**（秘密でない調整値）：`key, value, note`（例：`tldv_remaining_base=17`）

**dry_run_log**：`at, action, target, payload_summary`

- 書き込みは `LockService.getScriptLock()` の中で行う。`minutes.version` を更新のたびに +1。

---

## 12. 確認・編集画面（GAS-A Web アプリ）

- `executeAs: USER_DEPLOYING`（contact@）、`access: DOMAIN`。操作者は `Session.getActiveUser().getEmail()` で取得し、取れない場合は操作を拒否する（要確認：ドメイン内で取得できるか）。
- 利用者への案内 URL は `https://script.google.com/a/macros/premiere-mode.co.jp/s/{ID}/exec`（複数アカウント同時ログインの問題を避ける）。
- 見せる範囲：画面は contact@ の権限で動くので、Drive の権限が効かない。`masters_folders.rank` と `masters_people` で見せる範囲をアプリ内で制御する（ランク設計は要決定。決まるまでは管理者と確認者だけが開ける）。

### タブ1：議事録の確認
- 一覧：絞り込み（確認待ち・仕分け待ち・要対応・確定・対象外・自分が担当・日付・事業部）。列：日時、会議名、記録元（Meet／tl;dv）、状態、格納先、事業部領域、タスク提案数、確信度。
- 詳細（見るだけ）：会議キー、日時、会議名、主催者、参加者（社内・社外の印）、ファイルの状態とリンク、要約（決定事項・ネクストアクション）、判定の根拠と確信度、Notion の反映状態、変更履歴。
- 詳細（編集）：社内／社外、Drive の格納先（部署 or 顧客を検索。新規顧客は顧客名とドメイン必須）、事業部領域（6択から複数）、関連するプロジェクト（`ref/projects.json` から検索・複数）、議事録名。自動の値と現在の値の差を色で示す。社外参加者がいるのに社内を選ぶと警告。
- ボタン：このまま確定／修正して確定／保留／対象外／再実行（要対応のときだけ）。
- 確定時の処理順：フォルダ移動 → Notion 更新 → Chatwork 書き換え → change_log。失敗した段階で止めて `status=要対応`、`step_done_json` に完了済みの段階を残す。

### タブ2：タスク提案と変更ログ（段階5）
- 提案ごとに 承認／却下／保留／内容修正。変更前→変更後を並べる。新規・更新、プロジェクト／非プロジェクトの区分、依頼者・担当者を表示。
- 承認したものだけ反映。反映直前に Notion の現在値を読み直し、`before_json` と違えば止めて警告。
- 取り消し：

| 元の変更 | 取り消し |
|---|---|
| ステータス・期日の変更 | `before_json` の値に戻す |
| 新規作成 | ステータスを「対応不要」にする（削除しない） |
| 実施記録の追記 | `applied_block_ids_json` のブロックだけ削除 |
| 格納先の変更 | 元のフォルダへ移動し直す |

- 反映後に人が手を入れていたら（`last_edited_time` が反映時刻より新しい）取り消さず「要手動」と表示。

---

## 13. トリガーと間隔（すべて仮・設定で変更可）

| 処理 | 実行 | 間隔 |
|---|---|---|
| GAS-B `moverRun` | 各主催者 | 15分 |
| GAS-A `ingestTldv` | contact@ | 10分 |
| GAS-A `ingestInbox` | contact@ | 10分 |
| GAS-A `generatorRun`（OPENAI_API モードのみ） | contact@ | 10分 |
| GAS-A `exportRef`（projects.json / masters.json） | contact@ | 毎朝6時 |
| GAS-A `digestRun`（朝の一覧・催促・停止検知） | contact@ | 毎朝9時＋1時間ごとに停止検知 |

---

## 14. 制約（実装で考慮すること）
- GAS：1回の実行6分、UrlFetch のサイズ上限、トリガーの数の上限。1回の処理件数を絞り、途中から再開できるようにする。
- Notion：無料プランでゲスト以外が2人以上になるとブロック上限で書き込みが 403 になる。403 は「Notion保留」で溜め、`retryNotionPending()` でまとめて再送できるようにする。ゲストは API のユーザー一覧に出ない。存在しない選択肢名を送ると選択肢が増える可能性があるため、完全一致の名前だけを送る。
- Chatwork：自分の投稿だけ編集可。API の利用には組織管理者への申請が必要な場合がある。
- ChatGPT 予約タスク：書き込みで承認待ちになり止まることがある。使われない予約は一時停止することがある → 停止検知で通知。
- Meet：自動録画はホストか共同ホストが参加した時点で開始。定期予定は回が違っても Drive の同じサブフォルダにまとまる（ファイル単位で処理する）。

## 15. 実機で確かめること（実装と並行して報告）
1. 内部インテグレーションで `POST /v1/pages` が通るか（Notion の上限解除後）。ゲストを people プロパティに指定できるか。
2. ChatGPT 予約タスク（Cloud）から共有ドライブを読めるか、inbox に Doc と JSON を作れるか。承認待ちで止まらないか。
3. GAS-B で `attachments` から fileId を取れるか。共有ドライブへ移動できるか。移動後も予定の添付が有効か。
4. tl;dv 受信DB に届くページの形（トランスクリプトがプロパティか本文か、長い会議で切れないか、参加者の形式、会議URL から meetingId を取れるか）。
5. Chatwork の PUT 書き換え時に `[To]` で再通知が飛ぶか。
6. Web アプリで操作者のメールを取れるか。Windows の Chrome／Edge で複数アカウントにログインしているときに開けるか。

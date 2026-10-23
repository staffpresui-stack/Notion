# PC不要の議事録作成と本番切替

2026-10-23：6c9c653の本番通しは合格済み。新しい管理者一括収集の反映は[ドメイン全体の委任手順](DOMAIN_DELEGATION.md)だけを参照し、以下の初回本番切替・旧経路停止をやり直さないでください。GAS-Aは現状維持です。

## 今回の方式

GEMINI_NOTESを既定にします。GASが、MeetのGeminiメモ／tl;dvのAIノートと文字起こしを取得し、既存の内容を整形・転記します。新たなAI要約や推論、外部AI API、Codex、PC、予約タスクは使いません。仕分けと関連プロジェクトはマスタ・明示キーワードによる規則です。元のAIメモに無い決定・担当・期日は作りません。

- 記録機能のある会社Workspaceアカウント：主催者がGAS-Bへ一度登録。本人主催のMeetをAUTO検出して、ENVに対応する受信へ移動。
- 個人Gmail、または録画/メモ等のライセンスがない会社アカウント：tl;dvで記録し、Notion「tl;dv 受信」へ連携。GAS-Aが15分ごとに取り込み。
- GAS-Aは判定JSONと議事録DocをDriveへ保存し、Notion議事録DBを作成。本番のChatworkルーム451196858へメンションなしで通知。
- 社内外・部署・顧客を決められない、メモだけで文字起こしがない、日時の一部が不明：仕分け待ちと要確認。メモ限定には「文字起こしなし・メモから作成」を明示。

本番は新しい専用経路で、既存のテスト用ガードを一律に外していません。旧GAS確認Web画面・fixtures・LOCAL_CODEX等は引き続きテスト専用です。**社員の本番確認はNotionで行います。** 確認状態を「確定／保留／対象外」へ変更できます。Notionで状態を変えてもDriveのフォルダは自動移動しません。配置修正は管理者が行います。ページをゴミ箱へ入れる処理はありません。

## 今日の切替順（finance@管理者・Notionオーナー）

### 0. 旧経路を止める

テスト会議5の状態を確認。途中なら記録をリセットせず保留/完了状況を残します。旧コードのまま、Bは登録解除、Aは統合トリガーを解除（またはトリガー画面から自分のautomationTick_を削除）。旧TXT/ref/登録同期トリガーも停止。Macはlaunchctl bootoutで既存launchdを停止し、再起動時も再開しないよう登録を外します。クラウド予約タスクも停止。データ・JSON・Notionページ・重複防止記録は削除しません。

### 1. コード・サービスの反映

- GAS-A：dist/gas-core/Code.gsで全文置換、dist/gas-core/appsscript.jsonを反映。dev.gsは維持。新たに**Google Calendar API v3（識別子Calendar）**を追加し、calendar.readonlyスコープを承認。既存のDrive/Docsサービスは維持。標準CloudプロジェクトならCalendar APIも有効化。
- GAS-B：dist/gas-organizer/Code.gs・Register.html・appsscript.jsonを反映。スコープ追加なし。Webアプリは**アクセスしているユーザーとして実行、組織内（DOMAIN）**で新バージョンへ更新。社員にスクリプトの編集権限を渡しません。
- Aの既存Webアプリは本番社員確認に使いません。MYSELFのままで可。本番DBへアクセスする旧画面ガードは残しています。

### 2. GAS-Aの設定（まずDRY_RUN=true）

| プロパティ | 本番値 |
|---|---|
| ENV | prod |
| DRY_RUN | true（確認後false） |
| GENERATOR_MODE | GEMINI_NOTES |
| SHARED_DRIVE_ID | 0ALo4SlMVSpXdUk9PVA |
| FOLDER_SYSTEM_ID | 1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH |
| FOLDER_INBOX_RAW_ID | 1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB |
| LEDGER_SPREADSHEET_ID | 137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c |
| NOTION_DB_MINUTES | 4cf02dee-7a11-4319-ace1-e866d6a1a914 |
| NOTION_DB_TASKS | e321f1cb-3365-4a2c-9844-47f34734a9d7 |
| NOTION_DB_TLDV_INBOX | 400ca178-7419-80dd-a3e0-ef9e2267a64c |
| NOTION_TOKEN | 「MTG議事録連携（GAS）」の既存トークン。人が設定、共有しない |
| CHATWORK_TOKEN | 議事録確認ルームへ投稿できるアカウントのAPIトークン。人が入力 |
| CHATWORK_ROOM_ID | 451196858（未設定でもこの固定ルーム。別IDは拒否） |
| PRODUCTION_START_AT | **実際に本番で取り込み始める会議の開始日時**。例 2026-10-23T15:00:00+09:00。例をそのまま採用せず人が決める |
| INGEST_BATCH | 5（1〜10） |
| TLDV_WAIT_MIN | 60（議事録受信が早過ぎる場合の待機） |
| TLDV_CALENDAR_IDS | finance@へ読取共有した業務用カレンダーIDをJSON配列またはカンマ区切り。未着監視用 |
| TLDV_RECEIVE_TIMEOUT_MIN | 120（15〜1440）。予定終了後の受信未着閾値 |
| TLDV_REMAINING_ALERT | 5（管理者が登録した残回数の警告閾値） |
| CLASSIFICATION_RULES_JSON | 任意。例 `[{"domain":"EC","terms":["EC","通販定例"]}]`。既定は6部署の正式名を会議名で検索 |

テストの*_TESTプロパティは消さず保持しますが、本番の宛先に代用しません。NOTION_FIXTURE:*やテスト台帳は本番へコピーしません。新経路の記録は本番台帳とNOTES_PIPELINE:prod:<本番DB>:...で分離。旧LOCAL_CODEXの未着・連続失敗監視は動きません。

テスト検証を先に行う場合はENV=test・既存のテスト台帳/DB/受信IDを使用します。sourceのtl;dv受信DBは共通なので、**testでは受信ページの取り込み状態を書き換えず、Chatwork実投稿もしません**。testで作った議事録は本番へ持ち込みません。

### 3. 本番の初期準備・送信先確認

1. `setupNotesWorkspace()`をtrueで実行。既存の共有ドライブ・本番台帳・7部署フォルダの所属と、台帳ヘッダーを確認。予定は不足inbox/_done・99_対象外/_空、台帳シート、既存部署フォルダのマスタ登録だけ。
2. falseにして同関数を実行し、準備完了後trueへ戻す。既存ファイル/フォルダの改名・移動・削除なし。テストのサンプル顧客/社員マスタを本番へコピーしません。
3. `setupProductionNotionStatus()`をtrueで実行。本番議事録DBへ足す確認状態select（確認待ち／仕分け待ち／確定／保留／対象外）の不足分だけをログ確認。falseで実行、trueへ戻す。既存の選択肢・色・IDを維持。型がselect以外なら変更せず停止。test用の同じ準備は`setupNotesNotionStatus()`。
4. Notionオーナーcontact@が、MTG議事録・プロジェクト/タスク・tl;dv受信を内部インテグレーションに共有。受信DBの「取り込み状態」はselect、未処理／取り込み済み／対象外（Meet優先）／エラーを維持。読み取り/本文が無いリンクだけでは取り込めません。
5. 社員/顧客マスタを下記手順で入力。`checkNotesEnvironment()`を実行し**env=prod・本番DB/台帳/受信ID・room=451196858**、マスタ件数を確認。実書込はしません。
6. `sendNotesConnectionNotice()`をtrueで予定確認。falseで実行し、Chatworkの451196858にメンションなしの接続確認が1件来ることを確認、trueへ戻す。トークン未設定で本番パイプラインをfalseにすると停止します。

本番Notionの本文・項目構成がテストと違えば停止します。GASは本番の別DBへ勝手に代用しません。Google/Notion/Chatworkの通信障害や応答不明は安全に保留し、自動で二重作成しません。

### 4. GAS-Bの本番設定

BもENV=prod、DRY_RUN=true、MOVER_MODE=AUTO、SHARED_DRIVE_ID・FOLDER_SYSTEM_ID・FOLDER_INBOX_RAW_ID・PRODUCTION_START_ATをAと同じ値へ設定。MOVER_INTERVAL_MIN=15、MOVER_WAIT_MIN=20、MOVER_MEMO_WAIT_MIN=20を目安にします（メモだけなら20分経過後利用）。*_TESTはそのまま残し、値を本番IDに置き換えません。

Bの内部設定はENVに応じた実ルートを選択します。本番では_system/00_受信、testでは_system/_test/00_受信。処理済みキーも本番mover:prod:とテストを分離。PRODUCTION_START_ATより前の予定は処理しません。

finance@と会社Workspace社員に、共有ドライブの受信・主催者登録フォルダを扱える権限を管理者が付与。My Drive→共有ドライブ移動には本人の所有/移動権限が必要です。finance@での管理者権限は実機確認済みですが、一般社員の権限は1名で確認してください。権限が足りない場合は会社の管理者が修正し、代理実行では回避しません。

### 5. 無人運転を開始

A/BのDRY_RUN=falseを維持。Aで一度`setupAutomationTrigger()`を実行。15分の統合tickを1個作り、旧TXT/ref/登録同期の自分のトリガーを移行解除。Bは会社アカウント本人で登録画面から一度登録します（DOMAIN・本人として実行）。定期運転中に登録解除しません。

最初に短い本番確認用会議を1件ずつ（Workspace Meetとtl;dv）実施。以後関数を手動実行せず、Notion本番ページ・DriveのDoc/判定JSON・本番台帳・Chatwork通知を確認。2周期以上待って二重作成されないこと。GASは会議本文を外部AI APIへ送りません。

## 社員が最初に一度だけ行うこと

### Workspaceアカウントがある人

1. 管理者からGAS-B登録画面URLとDrive権限を受け取る。
2. **自分の@premiere-mode.co.jpでログイン**し、本人のGoogle認可を行い「登録」を1回押す。finance@の代理や個人Gmailでは登録できません。
3. 自分主催のMeetで、利用可能ならGeminiメモ・文字起こし・録画をオン。非公開と【記録なし】付きは除外。記録ファイルが無い予定は静かに対象外。
4. ライセンスに会議記録がない場合は、下のtl;dvも設定。会社アカウントがあるだけで録画/メモが付くとは扱いません。

### 個人Gmail・tl;dvを使う人

1. 自分のtl;dvアカウントで、自分の業務カレンダーを接続。自動参加する会議の範囲・録画の許可を設定。個人的な予定は対象に含めない。
2. tl;dv側のNotion連携を認可し、既存「tl;dv 受信」DBへ出力するよう設定。個人GmailにNotionの接続権限がない場合は、Notionオーナーcontact@が許可/接続設定を行う。各社員がcontact@のログイン情報を共有して使う方法は採用しない。
3. 無料プランの自動連携残回数・更新単位を本人の管理画面で確認。実際に1件、AIノート/文字起こし本文がDBへ届くことを確認。動画リンクだけではPC不要の本文取り込みはできない。
4. 受信DBの必須項目はタイトル、日付、参加者、AIメモまたはトランスクリプト。長さ・会議URLも設定。長さ/時刻が不足する場合はNotionの受信日時から待機し、本文は転記して時刻要確認・仕分け待ちにする（会議時刻は捏造しない）。本文内の文字起こしは「文字起こし／トランスクリプト／Transcript」見出しで区別する。本文の子ブロックもページングして取得する。
5. 未着監視を使う人は、**業務用カレンダー**をfinance@へ「予定の表示（すべての予定の詳細）」で共有し、管理者へカレンダーIDを渡す。個人の私的カレンダー全体を共有する必要はない。管理者がTLDV_CALENDAR_IDSへ登録する。

### Notionで確認する人（ゲスト）

Notionオーナーはcontact@、社員は個人Gmailのゲストのままで可。オーナーが本番MTG議事録DB（必要なら案件DB）をゲストへ適切な権限で共有。Notionビューに「確認状態が対象外以外」「確認待ち/仕分け待ち」を設定。ビューのフィルタだけではアクセス制限にならないため、実際の共有範囲も確認する。

社員をChatworkの議事録確認ルームへ参加させ、各自の通知設定も確認します（メンションは付けません）。社員は通知のNotionリンクを開き、内容・要確認を読んで確認状態を変更。NotionユーザーID未登録でも、ゲストのDB共有権限は別に設定できる。参加者peopleへ自動設定したい場合だけ、正しいNotionユーザーIDをマスタへ入力（APIで招待・推定しない）。

## 社員マスタをCSV/シート貼付で取り込む

1. 本番台帳にpeople_importシートを作成。config/templates/people_import.csvと同じ7列を1行目に貼り付け：
   `name,google_email,alt_emails,notion_user_id,domains,is_reviewer,is_admin`
2. google_emailは既存の社員識別メール（例：個人Gmail）。会社アカウントが判明したらalt_emailsへ追加。会社メールをgoogle_emailにする運用でも、全社員で一貫して対応を管理する。alt_emails/domainsの複数値はJSON配列かカンマ区切り。CSVではカンマを含むセルを正しく引用する。
3. notion_user_idは任意。分からなければ空欄、氏名やメールから架空のIDを作らない。is_reviewer/is_adminはGAS旧画面用で、今回のNotion確認権限とは別。社員は通常false、管理者の既存権限をインポートで変えない。
4. `importPeopleFromSheet()`をDRY_RUN=trueで件数・重複検査→falseで反映。Gmail/会社メールの別名を別社員が使う、別人への置換、重複、権限変更は事前に拒否。既存のNotion IDと別名は維持・マージ。CSVに無い社員を削除しない。
5. masters_clientsへ顧客名・メールドメイン・既存DriveフォルダIDを管理者が入力。フリーメールは顧客ドメイン判定に使わない。**gmail.com全体を社内ドメインに登録しない**。個人Gmailは社員マスタの完全一致で判定する。

## tl;dv無料上限とできること・できないこと

無料で、Notion連携上限を使わずに本文を無制限自動取得できる経路は、この環境では確認できていません。公式サイト本文にもアクセスできなかったため、プランの回数・期間・ボタン名を断定しません。共有リンクだけでは認証済みの全文が取得できるとは限らず、メール通知が全文を含む保証もありません。未確認のスクレイピング、APIキー取得、外部AI、PC運用へ自動切替しません。

**現時点は無料枠内のNotion連携です。枠を超えた後も無制限に自動取込できるとは保証しません。** 上限・自動参加・連携許可はtl;dv管理画面で各アカウント確認が必要です。

上限の監視は2つに分けます。

- 本番台帳settingsへ`key=tldv_quota:<tl;dvアカウントのメール>`、valueに`{"remaining":3,"checked_at":"2026-10-23T15:00:00+09:00"}`のように、管理画面で実際に確認した残数と時刻を入力。5以下で予告、0で別の上限通知。更新後増えれば解除。**自動取得/自動減算ではありません**。Notion受信件数からアカウント別の使用回数は推定しない。
- TLDV_CALENDAR_IDSで共有業務予定を独立監視。会議終了後120分を過ぎてもMeet/tl;dvの議事録が無ければ、Chatworkへ「受信未着（無料上限・自動参加・連携設定等を確認）」と通知。これにより上限で連携自体が届かない場合も検知できる。原因を上限と断定しない。カレンダー共有未設定ならこの検知はできない。残数もカレンダーも未設定なら監視未設定通知を出す。

無料枠が足りない場合は、Workspaceの記録可能な主催者で開催する、tl;dvの有償化、または利用中プランで提供される全文の自動配信手段を実機確認することが必要です。メール/Driveへ本文が実際に自動配信できるようになった場合、その形式に合わせたGAS受信を追加できます。

## 監視・復旧・停止

本番の通知と停止通知は451196858へメンションなし。test/DRY_RUNは予定ログだけ。GAS内の処理が2時間以上未完了・要対応、ソースの欠落、tl;dv未着/上限をchange_logと通知で知らせる。JSON未着・Mac連続失敗の旧監視はGEMINI_NOTESで無効。通知は障害ごとに重複を抑え、回復時に台帳へ記録する。

Notion作成/本文追記、Chatwork投稿の応答不明はpendingを残し、実データ確認まで再送しない。単純な再実行で二重作成しない。NOTES_PIPELINE:*やGOOGLE_CREATE_PENDING:*を消して再作成しない。Notion/Chatwork側で既存ページ・投稿を確認した後の復旧が必要。

GAS自身が止まった場合は同じGASからは通知できないため、finance@のトリガー失敗メールを受信確認。停止はA/BのDRY_RUN=true、B登録解除、AのremoveAutomationTrigger。社員のBトリガーは本人が解除する（他人のトリガーを管理者が列挙できるとは扱わない）。

## リリース確認と実機で残る点

- code上のtest/prod境界・再実行・メモ整形・Gmail判定・社員本人登録・通知先はローカルテスト済み。今回GAS実行、実DBへの項目追加、実投稿、デプロイは行っていません。
- 有効なCHATWORK_TOKEN、社員/会社アカウントの対応、Notionゲスト権限、一般社員の共有ドライブ移動権限は人が設定/検証する。
- 各tl;dv無料アカウントのNotion連携と本文出力・残回数、共有業務カレンダーの読み取りを1名で実機確認。これが満たせない社員については完全無人の本文取込を達成したとは扱わない。
- Notionに会議時刻が無いものは時刻要確認になり、Meetとの厳密な重複照合はしない。正確な日時がある場合はMeetを優先。後からMeetが来た場合はtl;dv側の確認状態を対象外にし、元ページは保持する。
- 通常の新しい会議で、Notion本番・Drive・Chatwork・台帳の通しと再実行を確認してから社員へ展開する。

本番の処理開始日時より前の会議は除外。日付だけのページは、開始日以降かつNotion受信日時が開始後であることを確認し、会議時刻は不明のまま要確認にします。ローカル201件のテスト、build/check/smokeを確認済みです。

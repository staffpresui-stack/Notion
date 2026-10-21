# 段階3：finance@で確認・編集画面を試す

対象は、069c759で取り込み済みのテスト台帳3行です。再投入・台帳初期化・Notionページ再作成・NOTION_FIXTURE:*の削除は不要です。Codexは実GASの実行・実サービスへの書き込み・デプロイをしていません。

## 1. GASに反映するファイル

finance@premiere-mode.co.jpで「MTG議事録自動化・本体」を開きます。

1. `dist/gas-core/Code.gs` 全文で「コード.gs」を置換します。
2. HTMLファイルを3つ作成します。エディタでの名前は **Index、Styles、Scripts** です。それぞれ `dist/gas-core/Index.html`、`Styles.html`、`Scripts.html` を全文貼り付けます。既にあれば置換します。
3. プロジェクト設定でマニフェストを表示し、`dist/gas-core/appsscript.json` を反映します。Drive v3と既存スコープに加え、本人メール確認の `userinfo.email`、Webアプリの `USER_DEPLOYING / MYSELF` が入っています。
4. ユーザー作成の `dev.gs` は残します。`devDryRunOn`、`devDryRunOff` の両方の関数の先頭に `assertFinanceOperator_();` を追加してください。将来ドメイン公開する際に他の利用者が設定変更できないようにするためです。リポジトリ側の公開管理関数にも同じ確認を追加済みです。

## 2. スクリプトプロパティ

段階2の値を維持します。以下はテスト用です。本番台帳IDに置換しないでください。

| キー | 値 |
|---|---|
| ENV | test |
| DRY_RUN | 最初はtrue |
| SHARED_DRIVE_ID | 0ALo4SlMVSpXdUk9PVA |
| FOLDER_SYSTEM_ID | 1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH |
| FOLDER_SYSTEM_TEST_ID | 1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW |
| FOLDER_INBOX_RAW_TEST_ID | 1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC |
| LEDGER_SPREADSHEET_ID | 1VrooNKgbSN5V579yk-m5Ag0j2atBcL_qFU1eQ5NSOTY |
| NOTION_DB_MINUTES_TEST | d9cc47f9-543e-4bcb-8ec8-27bebc0feac5 |
| NOTION_DB_TASKS_TEST | c908936a-6999-4119-9e9c-df364f5f5d1b |
| NOTION_DB_TLDV_INBOX | 400ca178-7419-80dd-a3e0-ef9e2267a64c |
| NOTION_TOKEN | 現在の「MTG議事録連携（GAS）」の値を維持。人が入力します |
| TEST_ENV_KEY | 段階2と同じ既存値。変更しません |
| REVIEW_MASTER_ACCESS | **false**（今回の追加。finance@だけを許可） |
| WEBAPP_URL | 手順4で取得する /exec のURL |
| REVIEW_TEST_FAIL_STEP | 通常は空または削除。再実行テスト時だけafter_drive |

CHATWORK_TOKEN、CHATWORK_ROOM_ID_TESTは今回追加不要です。トークンがなければPUT・[rp]返信とも送信せず、GAS実行ログとテスト台帳 `dry_run_log` に予定本文を残します。既存カードIDもない場合は、トークンを後で入れても新しいカードは勝手に投稿しません。実送信を試す際は別途テストルームと、そのトークン自身が投稿した既存カードが必要です。本番ルームと同じIDは禁止しています。

## 3. 閲覧マスタを準備する

1. DRY_RUN=trueで `setupReviewAccess()` を実行して予定を確認します。
2. `devDryRunOff()` でfalseにしてから `setupReviewAccess()` を1回実行します。初回は追加のGoogle認証が出ることがあります。finance@で許可します。
3. テスト台帳 `masters_people` にfinance@の行が追加され、`is_admin=true`、`is_reviewer=true` になっていることを確認します。既存行は上書きしません。finance@が既存行にあり役割がfalseなら、その行を人が修正します。重複行は作りません。
4. `devDryRunOn()` でtrueに戻します。

## 4. Webアプリをデプロイする

「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」で、以下を選びます。

- 実行するユーザー：**自分（finance@premiere-mode.co.jp）**。
- アクセスできるユーザー：**自分のみ**。

取得した `/exec` URLを `WEBAPP_URL` に保存して、finance@で開きます。複数アカウントで混乱する場合はfinance@だけのブラウザプロファイルを使います。`/dev` は動作確認用の案内URLに使いません。ドメイン形式のURLも利用できます。

一覧が開き、「利用者：finance@...」「予定確認モード」と表示されることを確認します。本人メールが取れない場合は拒否します。実行者の代わりに所有者メールを使う回避処理はありません。

以後コードを置換したときは「デプロイを管理」→編集→バージョン「新バージョン」→デプロイで既存URLを更新します。プロパティだけの変更は再デプロイ不要ですが、画面は再読み込みしてください。

## 5. 既存3件で確認する順番

最初はDRY_RUN=trueです。3行の一覧・状態／自分担当／日付（日本時間）／事業部の絞り込み、詳細、リンク、参加者、要約、タスク提案数を確認します。自動値と現在値が違う項目は色付きです。タスク提案はこの段階では作成しません。

「このまま確定」などを押すと `dry_run_log` に反映予定・PUT予定が増えます。議事録行のversion・状態・Drive・Notionは変わりません。仕分け待ちの「このまま確定」は格納先未決のため拒否されます。確定する場合は「修正して確定」で登録済み格納先を選びます。

次に `devDryRunOff()` を実行し、画面を再読み込みします。「テスト反映モード」になったことを確認します。

| 対象 | 操作と期待結果 |
|---|---|
| MTG-261021-01 | このまま確定 → 状態「確定」。同じ配置ならフォルダ移動なし、Notionは議事録名・事業部領域・関連するプロジェクトだけ更新し、本文は維持。PUT予定とchange_logが残ります。 |
| 同じ01 | 議事録名を変更して「修正して確定」→「確定・修正あり」。Notion名、PUT予定に加え、確定後の変更点の[rp]返信予定が残ります。 |
| MTG-261021-02 | 保留 → 状態「保留」。フォルダとNotionは変更せず、PUT予定とchange_logが残ります。 |
| 同じ02 | REVIEW_TEST_FAIL_STEP=after_driveを設定。格納先は有効な社外のまま、議事録名を変更して「修正して確定」→意図的停止で「要対応」。このプロパティは一度の停止で自動削除されます。「再実行」→未完了のNotion以降から再開して「確定・修正あり」。新しい議事録やNotionページは作られません。実際に移動も試す場合は別の有効な格納先を選びます。社外参加者ありで社内を選ぶ場合は確認チェックが必要です。 |
| MTG-261021-03 | 最後に「対象外」→確認ダイアログで承認すると、会議フォルダは_test/99_対象外へ移動、既存Notionページはアーカイブ、状態は「対象外」。完全削除はしません。_空は空の受信フォルダ専用です。対象外の復帰操作は実装していません。 |

移動→Notion→Chatwork→change_logの順に反映します。段階ごとに `step_done_json.review` とversionを保存します。after_notion、after_chatworkでも一度停止するテストができます。失敗時の再実行は保存した編集内容を使い、完了済みの段階を繰り返しません。処理記録と現在のフォルダ配置が違うと自動再開を止めます。Chatwork返信の送信結果が不明な場合も二重投稿を避けて停止します。

同時編集は、01を2つのタブで開き、一方で保留などを反映してから他方で操作します。後の操作は **「先に更新されました。画面を読み込み直してください。」** で拒否され、外部更新はありません。古いタブは一覧の行から開き直します。

最後に `devDryRunOn()`、画面再読み込みでtrueに戻してください。テストの状態・履歴・重複防止記録は維持します。

## 6. 将来社員に広げるとき

今回の試験では変更不要です。会社メール対応表を回収してから、masters_peopleのgoogle_email・alt_emails（JSON配列またはカンマ区切り）と役割を設定し、REVIEW_MASTER_ACCESS=trueにします。無効化はis_adminとis_reviewerを両方falseにします。文字列falseをtrue扱いしません。重複・不明メールは拒否します。

- is_admin：全件、仕分け待ち、新規顧客登録を操作できます。
- is_reviewerのみ：reviewer_email（空ならorganizer_email）が本人または別名の行だけ。masters_people.domainsがあれば全領域の一致が必要です。
- masters_folders.rankがあれば、settingsのkey=`review_rank_allow:主メールアドレス`、value=`["2","3"]`等で明示したランクだけ。未決時は空欄にするか、許可ランクを設定するまで拒否します。
- プロジェクト候補はテストDB所属を確認します。管理者はref/projects.json（配列またはprojects配列、id/titleまたはname）を優先し、未作成ならテストタスクDBを読み取ります。一般確認者はテストタスクDBの実際の事業部領域・格納先ランクで絞り、領域不明の候補は見せません。設定範囲外の関連先は送信も拒否します。

dev.gsを含む追加公開関数がfinance@以外の設定変更を許さないことを再確認した上で、Webアプリのアクセスを組織内だけに変えます。匿名・全員公開にはしません。実ユーザーでSession.getActiveUser()のメール取得と拒否ケースを必ず検証してください。所有者のDrive権限で動くため、台帳マスタの管理自体もfinance@が行います。

## ローカル検証と実機で残る確認

純粋な判定・権限・入力検証、処理順、DRY_RUN、版番号、途中失敗からの再開、テストNotion所属・アーカイブ制限をモックで検証しています。段階2の共有ドライブテストも継続実行しています。
実GASのHTMLテンプレート表示・Google本人識別・実Drive移動・実Notion更新とアーカイブは上記の実機試験が必要です。Chatworkトークンがないため実PUT・返信は未確認です。

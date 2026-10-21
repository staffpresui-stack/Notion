# 段階1：finance@の主催者用GAS-B

Geminiメモの文字起こしタブ方式への更新は [ORGANIZER_TABS_UPDATE.md](ORGANIZER_TABS_UPDATE.md) を先に参照してください。物理ファイル2件でも必要な内容が揃えばreadyになります。

GAS-Bは **別プロジェクト** です。本体GAS-Aのコードと混ぜません。今回の版はfinance@本人と、指定したテスト予定1件だけを扱います。ENV=test以外、指定の共有ドライブ・テスト受信フォルダ以外はコードで拒否します。社員への展開と本番切替はまだ行いません。

## 1. finance@で別プロジェクトを作る

1. finance@premiere-mode.co.jpでApps Scriptを開き、例「MTG議事録自動化・主催者用」を作成します。
2. `dist/gas-organizer/Code.gs`をコード.gsに全文貼り付けます。
3. HTMLファイル **Register** を作り、`dist/gas-organizer/Register.html`を全文貼り付けます。
4. プロジェクト設定からappsscript.jsonを表示し、`dist/gas-organizer/appsscript.json`を反映します。Drive API v3・Calendar API v3・Docs API v1を使用します。左の「サービス」に3つがあることを確認します。標準Cloudプロジェクトを使う場合は、そちらでも3つのAPIを有効にします。

スコープはDrive、Calendar読み取り、トリガー、本人メールだけです。Notion・ChatworkのトークンやGAS-A台帳のIDはGAS-Bに入れません。

## 2. GAS-Bのスクリプトプロパティ

GAS-Aとは別の設定です。GAS-Bの「プロジェクトの設定」で入力します。

| キー | 値 |
|---|---|
| ENV | test |
| DRY_RUN | 最初はtrue |
| SHARED_DRIVE_ID | 0ALo4SlMVSpXdUk9PVA |
| FOLDER_SYSTEM_ID | 1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH |
| FOLDER_SYSTEM_TEST_ID | 1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW |
| FOLDER_INBOX_RAW_TEST_ID | 1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC |
| MOVER_INTERVAL_MIN | 15（1・5・10・15・30から選択可） |
| MOVER_WAIT_MIN | 20（0〜1440分） |
| MOVER_TEST_EVENT_ID | 手順3で取得する、今回のテスト予定のCalendar API ID |

受信先を本番のFOLDER_INBOX_RAW_IDへ切り替えることはできません。GAS-AのTEST_ENV_KEYはGAS-Bにコピーしません。別プロジェクト間ではappPropertiesが共有されないため、GAS-Bは指定ID・実際の親階層・共有ドライブ所属を確認します。登録や会議受信フォルダの受け渡し用の目印はpropertiesを使います。

## 3. テスト予定を作り、予定IDを取得する

1. finance@が主催する短いGoogle Calendar予定を作り、Google Meetを追加します。予定自体の終了時刻も短く設定します（早く通話を切っても、処理の待ち時間はCalendarの予定終了時刻が基準です）。
2. Meetで録画・文字起こし・Geminiメモをオンにして、短い会議を実施します。利用プラン・管理者設定によって使える機能が違います。表示されない機能があれば、その事実を確認して止めてください。
3. GAS-Bのエディタで `checkOrganizerConfig()` を実行し、finance@で認証します。DRY_RUN=true、移動先IDがテスト受信であることを確認します。
4. `listOrganizerTestEvents()` を実行します。過去72時間〜翌日の自分主催Meet予定の「タイトル／開始日時／MOVER_TEST_EVENT_ID／添付数」がログに出ます。今回の予定IDをスクリプトプロパティに設定します。CalendarのURLを丸ごと設定したり、iCalUIDを設定したりしないでください。繰り返し予定の場合は対象回のインスタンスIDを使います。
5. 予定の添付とマイドライブで、録画とGeminiメモ（中に文字起こしタブ）、または録画・文字起こし・Geminiメモの3ファイルが生成されていることを確認します。通知が来ても予定のattachmentsに反映されるまで待つことがあります。

IDの取得関数は予定の読み取りだけです。MOVER_TEST_EVENT_IDがなければmoverRunは動きません。実機テストで過去の他の会議を誤って移動しないための制限です。

## 4. GAS-BをWebアプリとしてデプロイする

「新しいデプロイ」→「ウェブアプリ」で設定します。

- 実行するユーザー：**ウェブアプリにアクセスしているユーザー**。
- アクセスできるユーザー：**自分のみ**（今回はfinance@だけ）。

取得した/exec URLをfinance@だけのブラウザプロファイルで開き、finance@本人で認証します。利用者表示と予定確認モードを確認します。空の本人メール、別の社員メール、実行者が本人と違う場合は拒否します。社員展開のときはメール対応・権限設計を確認してからコードのfinance@限定を見直し、DOMAIN公開に進みます。

今後コードを変えたら「デプロイを管理」→編集→新バージョンで更新します。古い画面が残る場合は **cmd+shift+R（WindowsはCtrl+Shift+R）で強制再読み込み** してください。

## 5. DRY_RUNで確認する

1. 予定終了からMOVER_WAIT_MIN（既定20分）以上待ち、画面の「今すぐ確認する」、またはエディタの `moverRun()` を実行します。
2. 録画・メモ・文字起こしの内容が揃えば「移動予定」と、元ファイル名・種類・移動元・テスト移動先が表示されます。Drive、UserProperties、トリガー、登録ファイルは変更しません。GAS-Bの実行ログにも予定を残します。台帳編集権限を持たせないため、GAS-B自身はdry_run_logへ書き込みません。
3. 「添付待ち」なら、未到着の種類が表示されます。既定では必要な内容が揃うまで待ち（メモ内文字起こしタブも含む）、予定終了から48時間後は揃った分だけreadyにしてmissingへ不足を記載します。0件でもmissingに3種を明記し、内容を作りません。全て不足の場合は議事録生成へ進めず人が確認してください。
4. DRY_RUN=trueの「登録」は予定表示だけで、トリガーは増えません。

未知の添付は移動せずログに残します。同じ種類が複数あれば自動選択せず停止します。名前による判定は、動画→録画、Google文書の「文字起こし／Transcript」→文字起こし、「Gemini／メモ／Meeting notes／Notes by」→メモです。異なる命名ならファイル名・種類を報告してください。添付にないファイルをDrive全体から推測して探す機能はありません。

## 6. 実際の移動・トリガー・再実行を確認する

1. GAS-BのプロパティでDRY_RUN=falseに変更し、Web画面を再読み込みします。
2. 「この PC のアカウントで登録」を押します。moverRunの時間主導トリガーが **finance@自身の権限で1個だけ** 作られます。もう一度押しても増えません。_test/_organizersに登録ファイル1件が作られます。
3. 「今すぐ確認する」を押すか、登録後にエディタから `moverRun()` を実行します。自動実行の場合は15分程度待ちます。実機で権限エラーが出たら、実行履歴とエラー内容を確認し、権限を直すまで止めてください。コピー・削除への自動切替はありません。
4. テスト受信に `meet_<予定ID>_<開始時刻UTC>/` 相当の会議フォルダができ、タブ方式は2ファイル、別ファイル方式は3ファイルが移動していることを確認します。元ファイルIDを保ち、ファイルにmeeting_keyとkindのappPropertiesを付けます。
5. `manifest.json`を開き、source=meet、実際のevent_id・日時・主催者・参加者・Meet URL・filesの物理ファイルIDとtranscript_sourceの所在、missing=[]、status=readyを確認します。主催者が参加者一覧にない予定でも主催者を補います。readyのmanifestは全対象の移動成功後に作成します。
6. 同じ関数を再実行して「処理済み」となり、会議フォルダ・manifest・ファイルが増えたり再移動したりしないことを確認します。GAS-Aが後で受信フォルダを移動しても、GAS-B側の処理済み記録で再処理しません。UserPropertiesのorganizer_registrationやmover:*は消さないでください。
7. 部分的に移動して停止した場合は、同じID・会議フォルダを使って再開します。readyのmanifestは途中状態では作りません。

moverRunは自分主催・Meet付き・終了待ち時間経過後・指定IDの予定だけを処理します。Calendar一覧は72時間分を読み、指定予定が一覧外ならそのIDを再取得するため、48時間の不足待機を越えた予定も処理できます。Calendar.Events.listに非対応のsupportsAttachmentsは渡しません。

## 7. 共有ドライブ移動時の権限・所有権・添付リンクを実機確認する

API上、投稿者（writer）以上は共有ドライブへのファイル追加が可能です。ただし、実際のマイドライブからの移動にはファイル所有権、元と先の権限、組織の移動・共有制限が関係します。投稿者で必ず成功すると断定せず、今回のfinance@は共有ドライブの管理者として試してください。後に社員で試す場合は投稿者以上と移動可否を別途確認します。

- 移動前：3ファイルのID、所有者がfinance@であること、予定の添付から開けることを記録します。共有ドライブ「MTG記録」でfinance@のメンバー役割も確認します。
- 実行：GAS-BはownedByMe・所有者メール・移動能力・追加先の能力を検査し、Drive APIで同じIDの親だけを変更します。別人所有、別共有ドライブ、ショートカット、別会議に登録済みのファイルは移動しません。
- 移動後：3ファイルのIDが同じで、保存場所が_test/00_受信の会議フォルダになっていることを確認します。共有ドライブへ移すと所有は個人ではなく組織側へ移ります。元の個人所有へ自動で戻す処理はありません。
- Calendarを再読み込みし、同じ予定の録画・文字起こし・メモの **元の添付リンクを1つずつ開く**。finance@で動画の再生と文書本文の閲覧まで確認してください。
- 別の参加者でも確認する場合は、共有ドライブ・ファイルの閲覧を許可されたアカウントで行います。IDが同じでも、移動による権限変更・組織の外部共有制限により他の参加者のアクセスが変わる可能性があります。社員アカウント未準備の今回はその点を未確認として記録します。共有範囲を勝手に広げる処理はありません。

今回のコード・モックでは実所有権・Googleの移動制限・Calendarリンクを検証できません。上の実機結果をもって段階1の合否を判断します。予定の添付の付け替え・削除や、ファイルの完全削除は行いません。

## 8. 登録情報をGAS-Aのorganizersへ反映する

GAS-Bから台帳へ直接書くと社員への台帳編集権限が必要になり、所有者実行の公開doPostは受付の認証が増えます。そのため、**本人がDriveに登録ファイルを書く→GAS-Aが本人のDrive更新者を検証して台帳へ反映** する方式を採用しました。GAS-B利用者に台帳編集権限もNotionトークンも渡しません。初回版は受け渡し双方でfinance@だけを許可します。

1. **GAS-A本体**のCode.gsも `dist/gas-core/Code.gs` に更新し、`dist/gas-core/appsscript.json` も反映します。今回、同期トリガー管理用のscript.scriptappスコープを追加しています。GAS-AのHTMLは今回変更不要です。Web画面に変更はないので、同期だけならGAS-AのWeb再デプロイは不要です。
2. GAS-AのDRY_RUN=trueで `syncOrganizerRegistrations()` を実行します。finance@の登録予定がログとテスト台帳dry_run_logへ出ることを確認します。初回は追加権限をfinance@で認証します。
3. GAS-AでDRY_RUN=falseにし、同じ関数を実行します。**テスト台帳**organizersにfinance@1行、registered_at・Bのtrigger_id・last_run_at・last_resultが入ります。繰り返しても行は増えません。GAS-Aの既存プロパティ以外の追加は不要です。
4. 自動受け渡しを試す場合は、GAS-Aで `setupOrganizerSyncTrigger()` をtrueで予定確認後、falseで実行します。finance@の同期トリガーorganizerSyncTick_を15分ごとに1個だけ作ります。ブラウザから呼べない専用ハンドラで、finance@の実行者を検査します。不要になったらGAS-Aをfalseにして `removeOrganizerSyncTrigger()` を実行します。他のトリガーは消しません。
5. GAS-Bで「登録を解除」を押して、BのmoverRunトリガーが0個になることを確認します。GAS-Aで同期するとorganizersのtrigger_id・registered_atが空、last_resultが登録解除になります。台帳行・登録ファイルは削除しません。再登録すれば再開できます。
6. 試験後、**AとB両方のDRY_RUNをtrueへ戻します**。trueの間、Bは移動・登録状況ファイルの更新をせず、Aの同期はdry_run_logへの予定記録のみです。自動同期を止めたい場合はtrueへ戻す前に上記解除を実行します。

登録ファイルはpropertiesの用途、所定の名前、JSON形式、DriveのlastModifyingUser.emailAddressと登録メールの一致を検証します。更新者を取得できない、他人が編集した、同じメールが重複している場合は同期を止めます。ブラウザから渡したメールを信用しません。別の標準Cloudプロジェクトを使うA/Bでもpropertiesは読めます。BのappPropertiesはAから見えないので、受け渡しの認証に使いません。

## 今回確認した範囲

ローカルで登録・解除・重複防止、DRY_RUN、本人権限、テスト範囲制限、添付判定、3ファイルのID維持、途中再開、48時間不足処理、manifest、Aへの同期・偽装拒否、登録UIを検証しました。実GASの作成・デプロイ・認証・移動・実機リンク確認はユーザーが実施します。GAS-Aへの取り込み以降は別段階です。この試験だけでChatGPTが実会議の判定JSONを自動生成するわけではありません。

公式仕様：
- [Calendar Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Driveのロール](https://developers.google.com/workspace/drive/api/guides/ref-roles)
- [Drive所有権](https://developers.google.com/workspace/drive/api/guides/transfer-file)
- [カスタムプロパティ](https://developers.google.com/workspace/drive/api/guides/properties)
- [インストール型トリガー](https://developers.google.com/apps-script/guides/triggers/installable)

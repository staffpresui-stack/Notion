# 予約タスク用の参照ファイルをGAS-Aで作る

ChatGPT本体は **premiere・Plus** です。Google Driveコネクタに接続しているGoogleアカウントは **finance@premiere-mode.co.jp** です。参照ファイルはGAS-Aが作成し、ChatGPTは読み取りに使います。

## 反映・実行の順番

1. finance@の **GAS-A「MTG議事録自動化・本体」** で、コード.gsを `dist/gas-core/Code.gs` に全文置換して保存します。dev.gsは残します。HTML・マニフェスト・GAS-Bの更新、追加プロパティ、新しいスコープは不要です。エディタから実行する機能なので、Webアプリの再デプロイも不要です。
2. 既存のENV=test、テスト台帳・テストNotion DB・共有ドライブの設定を維持します。NOTION_TOKENも現在の値を使います。_system/_test/refは作成済みのものを使い、存在しない・同名複数なら停止します。
3. **DRY_RUN=trueで `exportRef()`** を実行します。社員・部署・顧客・社内判定・プロジェクトの件数と、masters.json／projects.jsonの作成または同じIDでの更新予定だけがログに出ます。Drive・台帳・スクリプトプロパティには書き込みません。
4. `devDryRunOff()`でfalseにし、**`exportRef()`** を実行します。MTG記録/_system/_test/refに2ファイルができ、各IDがログに出ます。Notionは読み取りのみです。
5. もう一度exportRefを実行し、ファイルが増えず **同じID** が出ることを確認します。両JSONのenv=test、generated_atが同じことを確認します。台帳マスタに更新があれば、次の実行で中身が更新されます。
6. **`devDryRunOn()`でtrueへ戻します。** GAS-BのDRY_RUNは変更しません。
7. `prompts/chatgpt_scheduled_task.md`の説明・指示文を予約タスクへ反映します。今回の出力は_test用です。ChatGPTから参照2ファイルとGeminiの指定文字起こしタブを実際に読めるか、ユーザー側の確認を継続してください。

既存のmasters.json／projects.jsonが複数あったり、同名のGoogleドキュメント・ショートカット等だったりする場合は上書きせず停止します。名前変更・移動・削除はしません。2ファイルは完全な一括更新ではないため、途中で失敗したら同じexportRefを再実行してください。予約タスクはgenerated_at不一致なら更新完了を待つ指示です。

作成時の応答が不明だった場合はREF_EXPORT_PENDING:*で重複作成を抑止します。同名ファイルが見つかれば次回はそのIDを更新して記録を解除します。ファイルが見つからない場合は人がDriveを確認するまで停止します。記録を無条件に削除しないでください。

## ファイルの中身

共通：schema_version=1、env=test、generated_at（同じ実行の2ファイルで同一時刻）。

masters.jsonは、現在の **テスト台帳** のマスタにある内容をそのまま参照用に絞ります。実社員情報やNotionユーザーIDを推測して補いません。

| 配列 | 項目 |
|---|---|
| folders | placement、notion_domain（配置先・部署） |
| clients | client_name、domains（顧客名・ドメイン） |
| internal | 社内判定用メール・ドメインの文字列 |
| people | name、google_email、notion_user_id、domains |

peopleは会社メール（@premiere-mode.co.jp）がある行だけ。対象外の件数はomittedPeopleで表示し、Notion IDの未入力はnullです。管理者・確認者フラグ、Chatwork ID、個人別名、DriveフォルダIDは出力しません。internalの社内判定用メール・ドメインは元のマスタどおりです。

projects.jsonはdatabase_idと **projects配列** を持ちます。

| 項目 | 内容 |
|---|---|
| id | テストNotionページID |
| title | プロジェクト／タスク名 |
| status | statusまたはselectの現在のステータス。未入力はnull |
| domains | 事業部領域の名前配列 |
| parent_ids | 同じテスト一覧内の親アイテムID配列 |
| due | 期日の開始日。未入力はnull |

本文・備考・担当者の自由記述などは出力しません。空DBはprojects=[]として正常終了します。本番DBは読み込み元に指定できません。データソースの所属を検証し、Notion-Version=2025-09-03のquery（読み取り用POST）で全ページを取得します。ゴミ箱のページは除外します。5000件超、重複ページ、不正なページ送り、HTTPエラーは途中データで既存ファイルを書き換えず停止します。

## 任意：毎朝の更新

今は手動のfalse→exportRef→trueで構いません。自動更新も試す場合だけ、以下を実行します。

- `setupRefExportTrigger()`：trueで予定確認後、falseで実行。finance@のrefExportTick_を **日本時間の毎朝6時台** に1個だけ作ります。既存トリガーがあれば再利用します。
- `removeRefExportTrigger()`：trueで予定確認後、falseで実行。自分が作ったrefExportTick_だけ解除し、他のトリガーは触りません。

DRY_RUN=trueの間は、定期実行も予定ログだけでファイルを更新しません。実更新にはGAS-A全体のDRY_RUN=falseが必要です。試験後はtrueへ戻してください。トリガーの有無は手動exportRefには影響しません。

## ChatGPT側はJSONだけをアップロードする

今回の追加実機結果では、通常チャットからGeminiメモの指定文字起こしタブを原文どおり読め、JSONの共有ドライブへのアップロードも成功しています。一方、Google Docを親フォルダ付きで作成するとOAuth接続ではINVALID_ARGUMENTとなるため、その方法は使いません。

1. premiere・Plusの予約タスクへ、更新したprompts/chatgpt_scheduled_task.mdを反映します。minutes_doc_id=null、minutes_markdownに全文（基本情報〜要確認）を入れたJSON1件を、_test/inboxへ **application/json** でアップロードさせます。ChatGPTにはDocを作らせません。
2. テスト中にmasters.json／projects.jsonがまだなければ、その一覧は空として続行し、要確認とopen_questionsへ記録させます。プロジェクトIDや実社員情報は推測しません。exportRefによる参照ファイル作成は並行して進められます。
3. GAS-AでDRY_RUN=trueのingestInboxを実行し、見出し・箇条書き・タスク提案表を含むNotion送信予定を確認します。この段階でDocは作りません。
4. 実機取り込みを試すときだけfalseでingestInboxを実行します。GAS-Aがinboxで作った議事録Docを会議フォルダへ配置します。基本情報〜要確認の見出し、リスト、タスク提案の表がDoc上で読め、Notionにも見出し・リスト・表が反映されることを確認してください。タスク提案そのものはまだタスクDBへ適用しません。
5. 同じ入力を再取り込みしてもDocが増えないことを確認し、DRY_RUN=trueへ戻します。既存のminutes_doc_id付き入力にも引き続き対応します。

Markdown例はfixtures/minutes_markdown_sample.md。`##`見出し、`###`小見出し、`-`箇条書き、`1.`番号付き、`|`表と`---`の区切り行を使用できます。セル内の縦棒は\|、JSON文字列内ではバックスラッシュもエスケープしてください。列数が合わない表は移動前に停止します。これは一般のMarkdown全機能を扱う変換ではありません。

エラーは{フォルダ名}.error.txtを **text/plain** として同じinboxへアップロードします。.error.txtはingestInboxのJSON取り込み対象外です。アップロードの許可UIは通常チャットで確認されていますが、「常に許可」で予約タスクが無人実行できるかは未確認です。許可待ち・保存失敗を完了扱いにしません。

## 軽微なログ修正と実機結果

syncOrganizerRegistrationsは、trueでは「同期予定」、falseの台帳保存成功後は **「同期しました」** と表示します。

段階1はユーザー実機で合格済みです。録画・Geminiメモの2件とmanifestがテスト受信へ移動し、ID・元リンク・元の空サブフォルダを維持、再実行は処理済み。Bの登録・解除とトリガー重複防止、Aのorganizersへの同じ行の同期更新・解除反映も確認済みです。今回追加した参照ファイル出力・定期更新はローカルテスト済みで、実GASでの実行はまだ行っていません。

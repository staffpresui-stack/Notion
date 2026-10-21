// scripts/bundle.cjs でfixturesから生成します。手で変更しないでください。
var NotionFixtures_ = {
  "judgements": [
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "scope": "社内",
      "placement": "社内/Salesforce・AI",
      "domains": [
        "Salesforce・AI"
      ],
      "related_project_ids": [
        "00000000-0000-0000-0000-000000000001"
      ],
      "minutes_title": "2026-10-21 議事録運用 打ち合わせ",
      "minutes_doc_id": "DOC_ID_TEST_001",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "参加者が全員社内で、議題が議事録自動化の運用設計だった",
      "sensitive": false,
      "summary": {
        "decisions": [
          "録画は Google Meet を優先し、相手主催の会議だけ tl;dv を使う"
        ],
        "next_actions": [
          {
            "who": "テスト 太郎",
            "what": "共有ドライブ「MTG記録」を作成する",
            "due": "2026-10-23"
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "プロジェクト",
          "target_id": null,
          "title": "共有ドライブ「MTG記録」を作成する",
          "requester_email": "test.hanako@premiere-mode.co.jp",
          "assignee_email": "test.taro@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": "2026-10-23",
            "備考": "",
            "完了条件": "7部署のフォルダがそろっている",
            "親プロジェクトID": "00000000-0000-0000-0000-000000000001",
            "事業部領域": [
              "Salesforce・AI"
            ]
          },
          "evidence": "テスト太郎さん：今週中にドライブを作ります"
        }
      ],
      "open_questions": []
    },
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "scope": "社外",
      "placement": "社外/サンプル商事様",
      "domains": [
        "セールス・マーケ"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 サンプル商事様 定例",
      "minutes_doc_id": "DOC_ID_TEST_002",
      "minutes_markdown": null,
      "confidence": "高",
      "reason": "社外参加者のドメイン sample-shoji.example が顧客一覧のサンプル商事様と一致",
      "sensitive": false,
      "summary": {
        "decisions": [
          "次回は11月第1週に開催する"
        ],
        "next_actions": [
          {
            "who": "テスト 花子",
            "what": "見積書を送付する",
            "due": null
          }
        ]
      },
      "task_proposals": [
        {
          "type": "新規",
          "task_db": "非プロジェクト",
          "target_id": null,
          "title": "サンプル商事様へ見積書を送付する",
          "requester_email": null,
          "assignee_email": "test.hanako@premiere-mode.co.jp",
          "fields": {
            "ステータス": "未着手",
            "期日": null,
            "備考": "期日：要確認",
            "完了条件": "",
            "親プロジェクトID": null,
            "事業部領域": [
              "セールス・マーケ"
            ]
          },
          "evidence": "テスト花子さん：見積を出します"
        }
      ],
      "open_questions": [
        "見積書の送付期日"
      ]
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "scope": "社外",
      "placement": "社外/未登録株式会社（要確認）",
      "domains": [
        "EC"
      ],
      "related_project_ids": [],
      "minutes_title": "2026-10-21 新規取引の相談",
      "minutes_doc_id": "DOC_ID_TEST_003",
      "minutes_markdown": null,
      "confidence": "低",
      "reason": "社名が文字起こしにしか出ず、顧客一覧に無い",
      "sensitive": false,
      "summary": {
        "decisions": [],
        "next_actions": []
      },
      "task_proposals": [],
      "open_questions": [
        "先方の社名の表記",
        "参加者の氏名"
      ]
    }
  ],
  "masters": {
    "folders": [
      {
        "placement": "社内/事業部全体",
        "notion_domain": null
      },
      {
        "placement": "社内/セールス・マーケ",
        "notion_domain": "セールス・マーケ"
      },
      {
        "placement": "社内/EC",
        "notion_domain": "EC"
      },
      {
        "placement": "社内/生産管理",
        "notion_domain": "生産管理"
      },
      {
        "placement": "社内/経理・バックオフィス",
        "notion_domain": "経理・バックオフィス"
      },
      {
        "placement": "社内/Salesforce・AI",
        "notion_domain": "Salesforce・AI"
      },
      {
        "placement": "社内/経営",
        "notion_domain": "経営"
      }
    ],
    "clients": [
      {
        "client_name": "サンプル商事様",
        "domains": [
          "sample-shoji.example"
        ]
      }
    ],
    "internal": [
      "premiere-mode.co.jp",
      "test.private@gmail.com"
    ],
    "people": [
      {
        "name": "テスト 太郎",
        "google_email": "test.taro@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      },
      {
        "name": "テスト 花子",
        "google_email": "test.hanako@premiere-mode.co.jp",
        "notion_user_id": null,
        "chatwork_account_id": null,
        "is_reviewer": true
      }
    ]
  },
  "manifests": [
    {
      "meeting_key": "meet:test002_20261021T050000Z",
      "source": "meet",
      "event_id": "test002_20261021T050000Z",
      "title": "サンプル商事様 定例",
      "start": "2026-10-21T14:00:00+09:00",
      "end": "2026-10-21T15:00:00+09:00",
      "organizer_email": "test.hanako@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        },
        {
          "email": "yamada@sample-shoji.example",
          "name": "山田"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {
        "recording": "FILE_REC",
        "transcript": "FILE_TR",
        "gemini": "FILE_GM"
      },
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T15:25:00+09:00"
    },
    {
      "meeting_key": "meet:test001_20261021T020000Z",
      "source": "meet",
      "event_id": "test001_20261021T020000Z",
      "title": "議事録運用 打ち合わせ",
      "start": "2026-10-21T11:00:00+09:00",
      "end": "2026-10-21T12:00:00+09:00",
      "organizer_email": "test.taro@premiere-mode.co.jp",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "email": "test.hanako@premiere-mode.co.jp",
          "name": "テスト 花子"
        }
      ],
      "meet_url": "https://meet.google.com/aaa-bbbb-ccc",
      "files": {},
      "missing": [],
      "status": "ready",
      "created_at": "2026-10-21T12:25:00+09:00"
    },
    {
      "meeting_key": "tldv:tldvtest003",
      "source": "tldv",
      "title": "新規取引の相談",
      "start": "2026-10-21T16:00:00+09:00",
      "end": "2026-10-21T16:40:00+09:00",
      "attendees": [
        {
          "email": "test.taro@premiere-mode.co.jp",
          "name": "テスト 太郎"
        },
        {
          "name": "先方担当"
        }
      ],
      "files": {},
      "status": "ready"
    }
  ]
};

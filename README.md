# ClaimPilot — Team INFUSION

ClaimPilot is a wHACKiest 2026 MVP that helps consumers investigate delayed
orders, possible duplicate charges, and supporting purchase evidence before
they decide what to do next.

## Problem and solution

Consumers often have to connect order messages, payment records, merchant
policies, and receipts manually. ClaimPilot brings those pieces into one
authenticated dashboard, highlights potential issues, prepares an editable
complaint template, and keeps the decision with the user.

## Current MVP capabilities

- Password and Google authentication backed by Flask sessions.
- SQLite persistence for users, claims, activity, reminders, warranties,
  refunds, settings, privacy controls, and uploaded evidence.
- Delayed-order investigation with actual MCP tool discovery and invocation.
- Ledger transaction, possible-duplicate review, and Subscription Trap Detector.
- Privacy Shield controls (PII masking in drafts, local-only processing, telemetry opt-out).
- Chase Modes (Gentle Nudge, Firm Escalation, Deadline Enforcement) with Inbox, Policy, and Calendar MCP integration.
- Live MCP Visualizer with dynamic `list_tools` discovery across all five stdio servers.
- Invoice PDF text extraction, claim comparisons, persistent report saving, and
  report download after refresh.
- Editable local complaint template with approve/reject decisions and
  per-claim history.
- Calendar & Reminders and Warranty Vault with persistent create, update/complete, and delete operations.

## Architecture

```text
React + Vite
    │ credentialed HTTP requests
    ▼
Flask API / session authentication
    ├── SQLite: claims, evidence metadata, decisions, activity and reminders
    ├── PyMuPDF: selectable invoice text extraction (no OCR)
    └── MCP client (stdio, tool discovery, invocation, result/error trace)
          ├── Inbox MCP
          ├── Ledger MCP
          ├── Policy MCP
          ├── Calendar MCP
          └── Vault MCP
```

### MCP servers and roles

Each server is a separate MCP process started by the client. The client
initializes a session, discovers tools, invokes the requested tool, and
propagates MCP errors. The activity trace records the session, discovered tool
names, invocation, result, and failure where applicable.

| Server | Tools | Demonstrable role |
| --- | --- | --- |
| `inbox_mcp.py` | `search_emails`, `record_approved_draft` | Find seeded order communication and record a demo approval. It never sends email. |
| `ledger_mcp.py` | `get_recent_transactions`, `detect_possible_duplicates`, `detect_subscription_traps` | Return seeded recent transactions, identify same-merchant/amount/date duplicate groups, and flag recurring subscription traps. |
| `policy_mcp.py` | `fetch_refund_policy` | Return illustrative policy guidance, explicitly not official merchant policy. |
| `calendar_mcp.py` | `create_reminder` | Validate a follow-up reminder; the app saves the accepted reminder in SQLite. |
| `vault_mcp.py` | `save_warranty` | Validate demo warranty details; the app saves accepted details in SQLite. |

These are real MCP protocol sessions and tool calls, but the server data and
actions are demo-only. The seeded inbox and ledger are not connected to a real
mailbox or bank.

## Technology

- Frontend: React 18, Vite, `jsPDF`, and `lucide-react`.
- Backend: Python, Flask, Flask-CORS, SQLite, PyMuPDF, Google Auth, and the MCP
  Python SDK.
- MCP transport: local stdio subprocesses.

## Setup

### Backend (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set:

- `SECRET_KEY`: a long, random value used to sign the Flask session cookie.
- `GOOGLE_CLIENT_ID`: the Google OAuth client ID configured for
  `http://localhost:5173`. The backend requires this setting at startup, even
  if you plan to use password login.

Do not commit `.env` or use production credentials in a demo environment.

Start the backend from the `backend` directory:

```powershell
python app.py
```

Flask listens on `http://localhost:5000`. SQLite is initialized automatically
at `backend/claimpilot.db`; existing records are retained and schema updates
are additive. Uploaded documents and generated reports are written under
`backend/uploads/evidence/` and are intentionally git-ignored.

### Frontend

In another terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Set `VITE_GOOGLE_CLIENT_ID` in `frontend/.env` to the same OAuth client ID as
the backend. Restart Vite after changing `.env`.

Open `http://localhost:5173`. The frontend API base is currently
`http://localhost:5000/api`.

## Verification

From `backend`:

```powershell
.\.venv\Scripts\python.exe -m py_compile app.py database.py mcp_client.py test_mcp.py test_workflow.py
.\.venv\Scripts\python.exe test_mcp.py
.\.venv\Scripts\python.exe -m unittest test_workflow.py
```

From `frontend`:

```powershell
npm run build
```

The workflow test uses a temporary SQLite database and temporary upload/report
directories; it does not operate on the project database or saved evidence.

## Demo workflow

1. Sign in and open the dashboard.
2. Select **Investigate delayed order**. The app calls Ledger, Inbox, and
   Policy MCP tools and links uploaded evidence already attached to the matching
   claim.
3. Review the retrieved transaction/order/policy context and invoice details.
4. Edit the local complaint template, then approve or reject it.
5. Reopen the claim to review the recorded MCP, evidence, and decision history.
6. Run **Check transactions**, create a follow-up reminder, and add a demo
   warranty to demonstrate Ledger, Calendar, and Vault MCP.
7. Generate and save the PDF analysis report; return to the evidence list to
   download the saved report.

See [docs/HACKATHON_DELIVERY.md](docs/HACKATHON_DELIVERY.md) for a timed
10-minute demo script, slide outline, video pitch script, and screenshot
checklist.

## Known limitations and truth-in-demo notes

- Complaint text is an editable local template. No generative AI model is wired
  in, so it is not represented as AI-generated.
- Inbox, Ledger, and Policy return seeded/illustrative data. No real email,
  bank, merchant policy, refund, or warranty provider is connected.
- Approval/rejection and Vault/Calendar operations are explicitly demo/local
  actions. No real email is sent and no money is moved.
- Invoice analysis extracts selectable text from PDFs. OCR is not installed;
  scanned PDFs return an explicit limitation instead of fabricated fields.
- Google sign-in requires a correctly configured OAuth client ID and origin.
- The local HTTP cookie settings are for development, not production
  deployment. Production deployment needs HTTPS and an appropriately secure
  session configuration.

## Screenshot checklist

No screenshots are included in this repository. For a submission capture:

1. Authenticated dashboard with the demo-mode notice.
2. Ledger MCP duplicate alert and retrieved transaction list.
3. Evidence Intelligence invoice comparison and saved-report control.
4. Complaint template with both approve and reject options visible.
5. Claim history showing actual MCP stages and the human decision.
6. Reminder and warranty demo records with their local/demo labels.


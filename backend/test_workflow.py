import importlib
import io
import os
from datetime import date, timedelta
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4

import pymupdf as fitz


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))


class ClaimPilotWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_environment = {
            key: os.environ.get(key)
            for key in ("SECRET_KEY", "GOOGLE_CLIENT_ID")
        }
        os.environ["SECRET_KEY"] = f"test-{uuid4().hex}"
        os.environ["GOOGLE_CLIENT_ID"] = (
            "claimpilot-test.apps.googleusercontent.com"
        )

        cls.temporary_directory = tempfile.TemporaryDirectory()
        cls.temporary_path = Path(cls.temporary_directory.name)

        cls.database_module = importlib.import_module("database")
        cls.original_database_path = cls.database_module.DB
        cls.database_module.DB = cls.temporary_path / "workflow-test.db"

        cls.app_module = importlib.import_module("app")
        cls.app_module.UPLOAD_FOLDER = cls.temporary_path / "evidence"
        cls.app_module.REPORT_FOLDER = (
            cls.app_module.UPLOAD_FOLDER / "reports"
        )
        cls.app_module.REPORT_FOLDER.mkdir(parents=True, exist_ok=True)
        cls.app_module.app.config["TESTING"] = True
        cls.client = cls.app_module.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.database_module.DB = cls.original_database_path
        cls.temporary_directory.cleanup()
        for key, value in cls.original_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def json(self, response):
        payload = response.get_json()
        self.assertIsInstance(payload, dict, response.get_data(as_text=True))
        return payload

    def test_investigation_evidence_decisions_and_all_mcp_roles(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(self.json(health)["ok"])

        email = f"workflow-{uuid4().hex}@example.test"
        password = f"test-only-{uuid4().hex}"
        registration = self.client.post(
            "/api/auth/register",
            json={
                "full_name": "Workflow Test",
                "email": email,
                "password": password
            }
        )
        self.assertEqual(registration.status_code, 201)
        self.assertTrue(self.json(registration).get("user"))

        self.client.post("/api/auth/logout")
        login = self.client.post(
            "/api/auth/login",
            json={
                "email": email,
                "password": password
            }
        )
        self.assertEqual(login.status_code, 200, login.get_data(as_text=True))

        preflight = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type"
            }
        )
        self.assertEqual(
            preflight.headers.get("Access-Control-Allow-Origin"),
            "http://localhost:5173"
        )
        self.assertEqual(
            preflight.headers.get("Access-Control-Allow-Credentials"),
            "true"
        )

        session = self.client.get("/api/auth/me")
        self.assertTrue(self.json(session).get("authenticated"))
        self.assertEqual(
            self.client.get("/api/dashboard").status_code,
            200
        )

        investigation = self.client.post("/api/investigate", json={})
        self.assertEqual(
            investigation.status_code,
            200,
            investigation.get_data(as_text=True)
        )
        claim = self.json(investigation)
        self.assertEqual(claim["status"], "Needs review")
        self.assertEqual(claim["draft_source"], "local_template")
        self.assertEqual(
            claim["delay_finding"]["status"],
            "confirmed_delayed"
        )
        self.assertTrue(claim["transactions"])

        invoice = fitz.open()
        page = invoice.new_page()
        page.insert_text(
            (72, 72),
            "\n".join([
                "SHOPKART",
                "Invoice number: TEST-INV-321",
                "Invoice date: 18 November 2026",
                "Order ID: SK-88421",
                "Description: Test Headphones",
                "TOTAL PAID: INR 3050.00"
            ])
        )
        invoice_bytes = invoice.tobytes()
        invoice.close()

        upload = self.client.post(
            f"/api/claims/{claim['claim_id']}/evidence",
            data={
                "file": (
                    io.BytesIO(invoice_bytes),
                    "workflow-invoice.pdf"
                )
            },
            content_type="multipart/form-data"
        )
        self.assertEqual(upload.status_code, 201, upload.get_data(as_text=True))
        evidence_id = self.json(upload)["evidence_id"]

        analysis_response = self.client.post(
            f"/api/evidence/{evidence_id}/analyze"
        )
        self.assertEqual(
            analysis_response.status_code,
            200,
            analysis_response.get_data(as_text=True)
        )
        analysis = self.json(analysis_response)
        self.assertEqual(analysis["extracted"]["merchant"], "SHOPKART")
        self.assertEqual(analysis["extracted"]["order_id"], "SK-88421")
        self.assertEqual(float(analysis["extracted"]["amount"]), 3050.0)
        self.assertEqual(analysis["extracted"]["product"], "Test Headphones")
        self.assertEqual(analysis["overall_status"], "matched")

        report_document = fitz.open()
        report_document.new_page().insert_text((72, 72), "Test report")
        report_bytes = report_document.tobytes()
        report_document.close()
        report_save = self.client.post(
            f"/api/evidence/{evidence_id}/report",
            data={
                "file": (
                    io.BytesIO(report_bytes),
                    "analysis-report.pdf"
                )
            },
            content_type="multipart/form-data"
        )
        self.assertEqual(report_save.status_code, 200)

        evidence_list = self.client.get(
            f"/api/claims/{claim['claim_id']}/evidence"
        )
        self.assertTrue(self.json(evidence_list)["evidence"][0]["report_available"])
        report_download = self.client.get(
            f"/api/evidence/{evidence_id}/report"
        )
        self.assertEqual(report_download.status_code, 200)
        self.assertTrue(report_download.data.startswith(b"%PDF"))
        report_download.close()

        transactions = self.client.post("/api/transactions", json={})
        self.assertEqual(transactions.status_code, 200)
        ledger = self.json(transactions)
        self.assertEqual(ledger["mode"], "seeded_demo")
        self.assertTrue(ledger["duplicate_alerts"])
        self.assertTrue(ledger["transactions"])

        reminder = self.client.post(
            "/api/reminders",
            json={
                "title": "Workflow test follow-up",
                "due_date": (date.today() + timedelta(days=1)).isoformat(),
                "claim_id": claim["claim_id"]
            }
        )
        self.assertEqual(reminder.status_code, 200, reminder.get_data(as_text=True))
        self.assertTrue(self.json(reminder)["created"])

        warranty = self.client.post(
            "/api/warranties",
            json={
                "product": "Workflow test product",
                "expiry_date": (date.today() + timedelta(days=365)).isoformat(),
                "serial_number": "TEST-VAULT-01",
                "file_name": "test-invoice.pdf"
            }
        )
        self.assertEqual(warranty.status_code, 200, warranty.get_data(as_text=True))
        self.assertTrue(self.json(warranty)["prepared"])

        approval = self.client.post(
            "/api/approve",
            json={
                "claim_id": claim["claim_id"],
                "draft": analysis["draft"],
                "decision": "approve"
            }
        )
        self.assertEqual(approval.status_code, 200, approval.get_data(as_text=True))
        self.assertEqual(self.json(approval)["status"], "Approved (demo)")

        duplicate_approval = self.client.post(
            "/api/approve",
            json={
                "claim_id": claim["claim_id"],
                "draft": analysis["draft"],
                "decision": "approve"
            }
        )
        self.assertEqual(duplicate_approval.status_code, 409)

        history = self.client.get(
            f"/api/claims/{claim['claim_id']}/history"
        )
        history_events = self.json(history)["events"]
        event_tools = {event["tool"] for event in history_events}
        self.assertIn("get_recent_transactions", event_tools)
        self.assertIn("search_emails", event_tools)
        self.assertIn("fetch_refund_policy", event_tools)
        self.assertIn("invoice_analysis", event_tools)
        self.assertIn("draft_approved", event_tools)

        rejected_investigation = self.client.post(
            "/api/investigate",
            json={
                "merchant": "Workflow Demo Merchant",
                "order_id": f"REJECT-{uuid4().hex[:8]}",
                "amount": 99
            }
        )
        self.assertEqual(
            rejected_investigation.status_code,
            200,
            rejected_investigation.get_data(as_text=True)
        )
        rejected_claim_id = self.json(rejected_investigation)["claim_id"]
        rejection = self.client.post(
            "/api/approve",
            json={
                "claim_id": rejected_claim_id,
                "decision": "reject"
            }
        )
        self.assertEqual(rejection.status_code, 200)
        self.assertEqual(self.json(rejection)["status"], "Rejected (demo)")
        repeated_rejection = self.client.post(
            "/api/approve",
            json={
                "claim_id": rejected_claim_id,
                "decision": "reject"
            }
        )
        self.assertEqual(repeated_rejection.status_code, 409)

        rejection_history = self.client.get(
            f"/api/claims/{rejected_claim_id}/history"
        )
        self.assertIn(
            "draft_rejected",
            {event["tool"] for event in self.json(rejection_history)["events"]}
        )

        # Test Subscription Trap Detector & Set reminder for StreamFlix and CloudDrive Pro
        sub_scan = self.client.post("/api/subscriptions/scan", json={})
        self.assertEqual(sub_scan.status_code, 200)
        sub_data = self.json(sub_scan)
        self.assertGreaterEqual(sub_data["traps_found"], 2)
        for trap in sub_data["traps"]:
            sub_rem = self.client.post(
                "/api/reminders",
                json={
                    "title": f"Review / cancel {trap['merchant']} subscription",
                    "due_date": trap["estimated_next_renewal"],
                    "notes": f"Subscription Trap Detector flagged {trap['merchant']}."
                }
            )
            self.assertEqual(sub_rem.status_code, 200, sub_rem.get_data(as_text=True))
            self.assertTrue(self.json(sub_rem)["created"])
            # Duplicate click prevention
            dup_rem = self.client.post(
                "/api/reminders",
                json={
                    "title": f"Review / cancel {trap['merchant']} subscription",
                    "due_date": trap["estimated_next_renewal"],
                    "notes": "Duplicate check"
                }
            )
            self.assertEqual(dup_rem.status_code, 409)

        # Test MCP Visualizer live tool discovery
        mcp_disc = self.client.post("/api/mcp/discover", json={})
        self.assertEqual(mcp_disc.status_code, 200)
        servers = self.json(mcp_disc)["servers"]
        self.assertEqual(len(servers), 5)
        for srv in servers:
            self.assertEqual(srv["status"], "connected")
            self.assertGreaterEqual(len(srv["tools"]), 1)

        # Test Privacy Shield persistence
        priv_put = self.client.put(
            "/api/privacy-settings",
            json={
                "analytics_enabled": False,
                "personalized_recommendations": True,
                "mask_pii_in_drafts": True,
                "local_only_mode": True
            }
        )
        self.assertEqual(priv_put.status_code, 200)
        priv_get = self.client.get("/api/privacy-settings")
        self.assertTrue(self.json(priv_get)["mask_pii_in_drafts"])
        self.assertTrue(self.json(priv_get)["local_only_mode"])

        # Test Chase Mode on a new pending claim
        chase_claim = self.client.post(
            "/api/investigate",
            json={"merchant": "ShopKart", "order_id": "SK-CHASE-1", "amount": 1200}
        )
        self.assertEqual(chase_claim.status_code, 200)
        chase_id = self.json(chase_claim)["claim_id"]
        chase_res = self.client.post(
            f"/api/claims/{chase_id}/chase",
            json={"mode": "escalation", "create_reminder": True}
        )
        self.assertEqual(chase_res.status_code, 200)
        self.assertEqual(self.json(chase_res)["chase_mode"], "Deadline Enforcement")

        # Test Reminder update & delete + Warranty update & delete
        rem_create = self.client.post(
            "/api/reminders",
            json={
                "title": "Test completion",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "notes": "Persist test"
            }
        )
        self.assertEqual(rem_create.status_code, 200)
        rem_id = self.json(rem_create)["reminder_id"]
        self.assertEqual(
            self.client.patch(f"/api/reminders/{rem_id}", json={"status": "Completed"}).status_code,
            200
        )
        self.assertEqual(self.client.delete(f"/api/reminders/{rem_id}").status_code, 200)

        war_create = self.client.post(
            "/api/warranties",
            json={
                "product": "Test Monitor",
                "expiry_date": (date.today() + timedelta(days=365)).isoformat(),
                "serial_number": "MON-001",
                "file_name": "mon.pdf"
            }
        )
        self.assertEqual(war_create.status_code, 200)
        war_id = self.json(war_create)["warranty_id"]
        self.assertEqual(
            self.client.patch(f"/api/warranties/{war_id}", json={"status": "Claimed"}).status_code,
            200
        )
        self.assertEqual(self.client.delete(f"/api/warranties/{war_id}").status_code, 200)

        # Test Loss Analytics and Refund Recovery Tracker
        # Create an open claim (amount 1200) for refund & analytics testing
        open_claim_res = self.client.post(
            "/api/investigate",
            json={"merchant": "RefundShop", "order_id": "REF-1001", "amount": 1200}
        )
        self.assertEqual(open_claim_res.status_code, 200)
        open_claim_id = self.json(open_claim_res)["claim_id"]

        analytics_before = self.client.get("/api/analytics")
        self.assertEqual(analytics_before.status_code, 200)
        ab = self.json(analytics_before)
        # Only open claims (chase_id=1200 + open_claim_id=1200) count; Approved/Rejected claims are excluded
        self.assertEqual(float(ab["potential_loss"]), 2400.0)
        self.assertEqual(float(ab["pending_refunds"]), 0.0)
        self.assertEqual(float(ab["confirmed_recovered"]), 0.0)
        self.assertEqual(ab["total_refund_records"], 0)

        # Validation: refund exceeding claim amount should return 400
        bad_refund = self.client.post(
            "/api/refunds",
            json={"claim_id": open_claim_id, "amount": 5000, "notes": "Too high"}
        )
        self.assertEqual(bad_refund.status_code, 400)

        # Create valid refund record (201)
        refund_create = self.client.post(
            "/api/refunds",
            json={"claim_id": open_claim_id, "amount": 1200, "notes": "Delayed order refund"}
        )
        self.assertEqual(refund_create.status_code, 201)
        refund_id = self.json(refund_create)["refund_id"]

        refunds_list = self.client.get("/api/refunds")
        self.assertEqual(refunds_list.status_code, 200)
        self.assertEqual(len(self.json(refunds_list)["refunds"]), 1)
        self.assertEqual(self.json(refunds_list)["refunds"][0]["status"], "Pending")

        analytics_pending = self.client.get("/api/analytics")
        self.assertEqual(analytics_pending.status_code, 200)
        self.assertEqual(float(self.json(analytics_pending)["pending_refunds"]), 1200.0)

        # Confirming without reference_number must return 400
        bad_confirm = self.client.patch(
            f"/api/refunds/{refund_id}",
            json={"status": "Confirmed", "reference_number": ""}
        )
        self.assertEqual(bad_confirm.status_code, 400)

        # Update to Processing then Confirmed with reference number
        patch_preflight = self.client.options(
            f"/api/refunds/{refund_id}",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type"
            }
        )
        self.assertIn(
            "PATCH",
            patch_preflight.headers.get("Access-Control-Allow-Methods", "")
        )

        proc_res = self.client.patch(
            f"/api/refunds/{refund_id}",
            json={"status": "Processing", "reference_number": ""}
        )
        self.assertEqual(proc_res.status_code, 200)
        self.assertEqual(self.json(proc_res)["refund"]["status"], "Processing")

        conf_res = self.client.patch(
            f"/api/refunds/{refund_id}",
            json={"status": "Confirmed", "reference_number": "UTR-998877"}
        )
        self.assertEqual(conf_res.status_code, 200)
        self.assertEqual(self.json(conf_res)["refund"]["status"], "Confirmed")
        self.assertEqual(
            self.json(conf_res)["refund"]["reference_number"],
            "UTR-998877"
        )

        # Verify persistence via fresh GETs
        refunds_after = self.client.get("/api/refunds")
        self.assertEqual(refunds_after.status_code, 200)
        saved_refund = self.json(refunds_after)["refunds"][0]
        self.assertEqual(saved_refund["status"], "Confirmed")
        self.assertEqual(saved_refund["reference_number"], "UTR-998877")

        analytics_after = self.client.get("/api/analytics")
        self.assertEqual(analytics_after.status_code, 200)
        aa = self.json(analytics_after)
        self.assertEqual(float(aa["pending_refunds"]), 0.0)
        self.assertEqual(float(aa["confirmed_recovered"]), 1200.0)
        self.assertEqual(aa["total_refund_records"], 1)

        # Test Create Test Claim (Demo) preserves existing claims and creates a unique Needs review claim
        claims_before_count = len(self.json(self.client.get("/api/dashboard"))["claims"])
        test_claim_res = self.client.post("/api/claims/test", json={})
        self.assertEqual(test_claim_res.status_code, 201)
        tc = self.json(test_claim_res)
        self.assertEqual(tc["status"], "Needs review")
        self.assertTrue(tc["order_id"].startswith("TEST-"))
        claims_after = self.json(self.client.get("/api/dashboard"))["claims"]
        self.assertEqual(len(claims_after), claims_before_count + 1)
        self.assertTrue(any(c["id"] == tc["claim_id"] for c in claims_after))

        # Verify POST /api/investigate with {} picks up the latest Needs review claim (DemoMart), not an approved ShopKart claim
        inv_demo = self.client.post("/api/investigate", json={})
        self.assertEqual(inv_demo.status_code, 200, inv_demo.get_data(as_text=True))
        inv_demo_data = self.json(inv_demo)
        self.assertEqual(inv_demo_data["claim_id"], tc["claim_id"])
        self.assertEqual(inv_demo_data["merchant"], "DemoMart")
        self.assertEqual(inv_demo_data["order_id"], tc["order_id"])
        self.assertEqual(inv_demo_data["status"], "Needs review")
        demo_history = self.json(self.client.get(f"/api/claims/{tc['claim_id']}/history"))["events"]
        demo_tools = {e["tool"] for e in demo_history}
        self.assertIn("investigation_started", demo_tools)
        self.assertIn("investigation_completed", demo_tools)
        self.assertIn("fetch_refund_policy", demo_tools)


if __name__ == "__main__":
    unittest.main()

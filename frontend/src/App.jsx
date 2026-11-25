import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import {
  ShieldCheck,
  Search,
  RefreshCw,
  Bell,
  LockKeyhole,
  Timer,
  Network,
  ScanEye,
  CalendarDays,
  ArrowUpRight,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Activity,
  Wallet,
  Sparkles,
  Database,
  LoaderCircle,
  LayoutDashboard,
  ScanSearch,
  Receipt,
  Settings as SettingsIcon,
  LifeBuoy,
  UserRound,
  LogOut
} from "lucide-react";

import Auth from "./Auth";
import Profile from "./Profile";
import SettingsPage from "./Settings";
import HelpSupport from "./HelpSupport";
import ClaimInsights from "./ClaimInsights";
import { formatDateTime } from "./dateTime";
import "./style.css";
import { jsPDF } from "jspdf";

const API = "http://localhost:5000/api";

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

const PAGE_PATHS = {
  overview: "/",
  "priority-actions": "/money-leak-radar",
  "claim-workspace": "/claims",
  analytics: "/loss-analytics",
  refunds: "/refund-recovery",
  "evidence-intelligence": "/evidence-intelligence",
  transactions: "/transactions",
  "privacy-shield": "/privacy-shield",
  "chase-modes": "/chase-mode",
  "mcp-trace": "/mcp-visualizer",
  "subscription-traps": "/subscription-trap-detector",
  calendar: "/calendar",
  "warranty-vault": "/warranty-vault",
  reminders: "/reminders",
  settings: "/settings",
  help: "/help-support"
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([key, path]) => [path, key])
);

const VALID_PAGES = new Set(Object.keys(PAGE_PATHS));

function getPageFromUrl() {
  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
  if (PATH_TO_PAGE[normalizedPath]) {
    return PATH_TO_PAGE[normalizedPath];
  }
  const pathKey = normalizedPath.replace(/^\/+/, "");
  if (pathKey && VALID_PAGES.has(pathKey)) {
    return pathKey;
  }
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  if (page && VALID_PAGES.has(page)) {
    return page;
  }
  const hashPage = window.location.hash.replace(/^#\/?/, "");
  if (hashPage && VALID_PAGES.has(hashPage)) {
    return hashPage;
  }
  return "overview";
}

export default function App() {
  const [user, setUser] = useState(null);

  const [dashboard, setDashboard] = useState({
    claims: [],
    activity: [],
    reminders: [],
    warranties: [],
    recent_transactions: [],
    monthly_spending: [],
    detected_alerts: [],
    transaction_mode: null,
    transaction_last_synced: null,
    metrics: {}
  });

  const [userProfile, setUserProfile] = useState({
    full_name: "",
    email: "",
    phone: "",
    location: "",
    image_url: ""
  });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dashboardUnavailable, setDashboardUnavailable] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [transactionSyncStale, setTransactionSyncStale] = useState(false);

  const [claim, setClaim] = useState(null);
  const [draft, setDraft] = useState("");
  const [claimHistory, setClaimHistory] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [evidenceClaimId, setEvidenceClaimId] = useState("");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceItems, setEvidenceItems] = useState([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceReport, setEvidenceReport] = useState(null);
  const [analysisBusyId, setAnalysisBusyId] = useState(null);

  const [showProfile, setShowProfile] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => getPageFromUrl());

  const [activeSection, setActiveSection] = useState(() => getPageFromUrl());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [subscriptionScan, setSubscriptionScan] = useState(null);
  const [subscriptionReminderBusy, setSubscriptionReminderBusy] = useState(null);
  const [mcpDiscovery, setMcpDiscovery] = useState(null);
  const [privacyShield, setPrivacyShield] = useState({
    analytics_enabled: false,
    personalized_recommendations: true,
    mask_pii_in_drafts: true,
    local_only_mode: true
  });
  const [chaseClaimId, setChaseClaimId] = useState("");
  const [chaseMode, setChaseMode] = useState("gentle");
  const [chaseResult, setChaseResult] = useState(null);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderNotes, setReminderNotes] = useState("");
  const [warrantyProduct, setWarrantyProduct] = useState("");
  const [warrantyExpiry, setWarrantyExpiry] = useState("");
  const [warrantySerial, setWarrantySerial] = useState("");
  const [warrantyFileName, setWarrantyFileName] = useState("");

  // PRESERVE SIDEBAR SCROLL POSITION

  const sidebarNavigationRef = useRef(null);
  const sidebarScrollPosition = useRef(0);

  useLayoutEffect(() => {
    if (sidebarNavigationRef.current) {
      sidebarNavigationRef.current.scrollTop =
        sidebarScrollPosition.current;
    }
  }, [currentPage, sidebarOpen]);

  const clearAuthenticatedState = useCallback(() => {
    setUser(null);
    setUserProfile({
      full_name: "",
      email: "",
      phone: "",
      location: "",
      image_url: ""
    });
    setDashboard({
      claims: [],
      activity: [],
      reminders: [],
      warranties: [],
      recent_transactions: [],
      monthly_spending: [],
      detected_alerts: [],
      transaction_mode: null,
      transaction_last_synced: null,
      metrics: {}
    });
    setClaim(null);
    setDraft("");
    setClaimHistory([]);
    setEvidenceItems([]);
    setEvidenceReport(null);
    setTransactionSyncStale(false);
    setDashboardUnavailable(false);
    setError("");
    setMessage("");
  }, []);

  // CHECK EXISTING SESSION

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch(`${API}/auth/me`, {
        method: "GET",
        credentials: "include"
      });

      const data = await response.json();

      if (!response.ok || !data.authenticated || !data.user) {
        clearAuthenticatedState();
        return null;
      }

      setUser(data.user);
      setUserProfile(data.user);
      return data.user;
    } catch (err) {
      console.error("Session check failed:", err);
      clearAuthenticatedState();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearAuthenticatedState]);

  // AUTHENTICATION CALLBACK

  const handleAuthenticated = useCallback(async () => {
    const authenticatedUser = await checkSession();

    if (!authenticatedUser) {
      throw new Error(
        "Could not verify the authenticated session. Please try again."
      );
    }

    setError("");
    setMessage("");
  }, [checkSession]);

  // LOAD DASHBOARD

  const refresh = useCallback(async () => {
    setError("");

    try {
      const response = await fetch(`${API}/dashboard`, {
        credentials: "include"
      });

      if (response.status === 401) {
        clearAuthenticatedState();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Dashboard request failed.");
      }

      setDashboard({
        claims: data.claims || [],
        activity: data.activity || [],
        reminders: data.reminders || [],
        warranties: data.warranties || [],
        recent_transactions: data.recent_transactions || [],
        monthly_spending: data.monthly_spending || [],
        detected_alerts: data.detected_alerts || [],
        transaction_mode: data.transaction_mode || null,
        transaction_last_synced: data.transaction_last_synced || null,
        metrics: data.metrics || {}
      });
      setDashboardUnavailable(false);

    } catch (err) {
      console.error("Dashboard loading error:", err);
      setDashboard({
        claims: [],
        activity: [],
        reminders: [],
        warranties: [],
        recent_transactions: [],
        monthly_spending: [],
        detected_alerts: [],
        transaction_mode: null,
        transaction_last_synced: null,
        metrics: {}
      });
      setTransactionSyncStale(false);
      setDashboardUnavailable(true);
      setError(err.message || "Could not load dashboard data.");
    }
  }, [clearAuthenticatedState]);

  async function loadClaimHistory(claimId) {
    if (!claimId) {
      setClaimHistory([]);
      return;
    }

    setHistoryBusy(true);
    try {
      const response = await fetch(
        `${API}/claims/${claimId}/history`,
        { credentials: "include" }
      );

      if (response.status === 401) {
        clearAuthenticatedState();
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load investigation history.");
      }

      setClaimHistory(data.events || []);
    } catch (err) {
      setError(err.message || "Could not load investigation history.");
    } finally {
      setHistoryBusy(false);
    }
  }

  // LOAD PROFILE

  const loadUserProfile = useCallback(async () => {
    try {
      const response = await fetch(`${API}/profile`, {
        credentials: "include"
      });

      if (response.status === 401) {
        clearAuthenticatedState();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load profile.");
      }

      setUserProfile((previous) => ({
        ...previous,
        ...data
      }));
    } catch (err) {
      console.error("Profile loading error:", err);
    }
  }, [clearAuthenticatedState]);

  // INITIAL SESSION CHECK

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // LOAD DATA AFTER LOGIN

  const loadPrivacyShield = useCallback(async () => {
    try {
      const response = await fetch(`${API}/privacy-settings`, {
        credentials: "include"
      });
      if (response.ok) {
        const data = await response.json();
        setPrivacyShield({
          analytics_enabled: Boolean(data.analytics_enabled),
          personalized_recommendations: Boolean(data.personalized_recommendations),
          mask_pii_in_drafts: data.mask_pii_in_drafts !== undefined ? Boolean(data.mask_pii_in_drafts) : true,
          local_only_mode: data.local_only_mode !== undefined ? Boolean(data.local_only_mode) : true
        });
      }
    } catch (err) {
      console.error("Privacy shield load error:", err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
      loadUserProfile();
      loadPrivacyShield();
    }
  }, [user, refresh, loadUserProfile, loadPrivacyShield]);

  // SCROLL TO SELECTED DASHBOARD SECTION

  useEffect(() => {
    if (currentPage !== "overview") return;

    const element = document.getElementById(activeSection);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }, [currentPage, activeSection]);

  // COMMON POST REQUEST

  async function post(path, body = {}) {
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`${API}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(body)
      });

      if (response.status === 401) {
        clearAuthenticatedState();
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Something went wrong.");
      }

      await refresh();
      return result;
    } catch (err) {
      setError(err.message || "Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // INVESTIGATE DELAYED ORDER

  async function investigate(targetClaim = null) {
    const selected =
      targetClaim && (targetClaim.id || targetClaim.claim_id)
        ? { ...targetClaim, id: targetClaim.id || targetClaim.claim_id }
        : claim && claim.status === "Needs review"
          ? { ...claim, id: claim.id || claim.claim_id }
          : dashboard.claims.find((item) => item.status === "Needs review");

    const payload = selected
      ? {
          claim_id: selected.id,
          merchant: selected.merchant,
          order_id: selected.order_id,
          amount: selected.amount
        }
      : {};

    const result = await post("investigate", payload);

    if (result) {
      setClaim({
        ...result,
        id: result.claim_id
      });
      setDraft(result.draft || "");
      await loadClaimHistory(result.claim_id);
      navigateTo("claim-workspace");
      setMessage(
        "Investigation complete. Review the retrieved demo data and editable template."
      );
    }
  }

  async function createTestClaim() {
    const result = await post("claims/test", {});

    if (result) {
      setClaim({
        ...result,
        id: result.claim_id
      });
      setDraft(result.draft || "");
      await loadClaimHistory(result.claim_id);
      navigateTo("claim-workspace");
      setMessage(
        result.message || "Demo test claim created and ready for review."
      );
    }
  }

  async function decideClaim(decision) {
    if (!claim) return;

    const result = await post("approve", {
      claim_id: claim.claim_id,
      draft,
      decision
    });

    if (result) {
      setClaim((previous) => ({
        ...previous,
        status: result.status
      }));
      setMessage(result.message);
      await loadClaimHistory(claim.claim_id);
    }
  }

  // CHECK DUPLICATE TRANSACTIONS

  async function checkDuplicates() {
    const result = await post("transactions", {});

    if (result) {
      setTransactionSyncStale(false);
      setMessage(result.mode === "seeded_demo"
        ? "Seeded Ledger MCP data loaded for review."
        : "Ledger transaction results loaded."
      );
    } else {
      setTransactionSyncStale(true);
    }
  }

  // CREATE REMINDER

  async function createReminder() {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    const dueDateString = [
      dueDate.getFullYear(),
      String(dueDate.getMonth() + 1).padStart(2, "0"),
      String(dueDate.getDate()).padStart(2, "0")
    ].join("-");

    const result = await post("reminders", {
      title: claim
        ? `Follow up on order ${claim.order_id}`
        : "Review the selected consumer issue",
      due_date: dueDateString,
      notes: claim
        ? `Follow up on ${claim.merchant} order ${claim.order_id}.`
        : "Follow up on a consumer issue.",
      claim_id: claim?.claim_id
    });

    if (result) {
      setMessage(result.message || "Demo reminder created.");
    }
  }

  // EVIDENCE INTELLIGENCE

async function loadEvidence(claimId) {
  if (!claimId) {
    setEvidenceItems([]);
    return;
  }

  try {
    const response = await fetch(
      `${API}/claims/${claimId}/evidence`,
      { credentials: "include" }
    );

    if (response.status === 401) {
      clearAuthenticatedState();
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load evidence.");
    }

    setEvidenceItems(data.evidence || []);
  } catch (err) {
    setError(err.message);
  }
}

useEffect(() => {
  loadEvidence(evidenceClaimId);
}, [evidenceClaimId]);

async function analyzeEvidence(item) {
  setAnalysisBusyId(item.id);
  setEvidenceReport(null);
  setError("");
  setMessage("");
  try {
    const response = await fetch(
      `${API}/evidence/${item.id}/analyze`,
      {
        method: "POST",
        credentials: "include"
      }
    );

    if (response.status === 401) {
      clearAuthenticatedState();
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Invoice analysis failed.");
    }

    setEvidenceReport({ ...data, evidence_id: item.id });
    if (
      claim &&
      String(claim.claim_id) === String(item.claim_id)
    ) {
      setDraft(data.draft || "");
      setClaim((previous) => ({
        ...previous,
        draft: data.draft || ""
      }));
    }
    await loadClaimHistory(item.claim_id);
    setMessage("Invoice analysis completed.");
  } catch (err) {
    setError(err.message);
  } finally {
    setAnalysisBusyId(null);
  }
}

async function downloadSavedReport(item) {
  try {
    const response = await fetch(
      `${API}/evidence/${item.id}/report`,
      { credentials: "include" }
    );

    if (response.status === 401) {
      clearAuthenticatedState();
      return;
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Could not download saved report.");
    }

    const reportBlob = await response.blob();
    const downloadUrl = URL.createObjectURL(reportBlob);
    const link = document.createElement("a");
    const safeName = item.original_name
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9_-]/gi, "_");
    link.href = downloadUrl;
    link.download = `${safeName}_Analysis_Report.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setMessage("Saved analysis report downloaded.");
  } catch (err) {
    setError(err.message || "Could not download saved report.");
  }
}

async function downloadInvoiceReport() {
  if (!evidenceReport) return;

  const doc = new jsPDF();
  let y = 20;

  const addLine = (text, gap = 9) => {
    const lines = doc.splitTextToSize(String(text), 170);

    if (y + lines.length * 7 > 275) {
      doc.addPage();
      y = 20;
    }

    doc.text(lines, 20, y);
    y += lines.length * 7 + gap;
  };

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  addLine("ClaimPilot - Invoice Analysis Report", 12);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  addLine(`Document: ${evidenceReport.file_name}`);
  addLine(`Generated: ${formatDateTime(new Date())}`);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  addLine("Overall Verification Result", 8);

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");

  const status =
    evidenceReport.overall_status === "matched"
      ? "All claim fields matched"
      : evidenceReport.overall_status === "needs_review"
        ? "Mismatch detected - Review required"
        : "Incomplete - Some invoice details were not found";

  addLine(`Status: ${status}`, 12);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  addLine("Invoice and Claim Comparison", 8);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  Object.values(evidenceReport.comparison).forEach((field) => {
    addLine(field.label);
    addLine(`Invoice value: ${field.invoice_value ?? "Not found"}`, 3);
    addLine(`Claim value: ${field.claim_value ?? "Not available"}`, 3);
    addLine(`Verification: ${field.status.toUpperCase()}`, 8);
  });

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  addLine("Additional Extracted Details", 8);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  addLine(
    `Invoice date: ${evidenceReport.extracted.invoice_date || "Not found"}`
  );

  addLine(
    `Product: ${evidenceReport.extracted.product || "Not found"}`
  );

  doc.setFontSize(9);
  addLine("Generated by ClaimPilot Evidence Intelligence.");

  const safeName = evidenceReport.file_name
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9_-]/gi, "_");
  const filename = `${safeName}_Analysis_Report.pdf`;
  const pdfBlob = doc.output("blob");
  const formData = new FormData();
  formData.append("file", pdfBlob, filename);

  try {
    const response = await fetch(
      `${API}/evidence/${evidenceReport.evidence_id}/report`,
      {
        method: "POST",
        credentials: "include",
        body: formData
      }
    );

    if (response.status === 401) {
      clearAuthenticatedState();
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not save PDF report.");
    }

    const downloadUrl = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    await loadEvidence(evidenceClaimId);
    setMessage("PDF report saved successfully.");
  } catch (err) {
    setError(err.message);
  }
}

async function uploadEvidence() {
  if (!evidenceClaimId) {
    setError("Please select a claim.");
    return;
  }

  if (!evidenceFile) {
    setError("Please choose a file.");
    return;
  }

  const allowed = ["pdf", "png", "jpg", "jpeg", "webp"];
  const extension = evidenceFile.name.split(".").pop().toLowerCase();

  if (!allowed.includes(extension)) {
    setError("Only PDF, PNG, JPG, JPEG and WEBP files are allowed.");
    return;
  }

  if (evidenceFile.size > 10 * 1024 * 1024) {
    setError("File size must not exceed 10 MB.");
    return;
  }

  setEvidenceBusy(true);
  setError("");
  setMessage("");

  try {
    const formData = new FormData();
    formData.append("file", evidenceFile);

    const response = await fetch(
      `${API}/claims/${evidenceClaimId}/evidence`,
      {
        method: "POST",
        credentials: "include",
        body: formData
      }
    );

    if (response.status === 401) {
      clearAuthenticatedState();
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Evidence upload failed.");
    }

    setMessage(data.message || "Evidence uploaded successfully.");
    setEvidenceFile(null);

    const fileInput = document.getElementById("evidence-file");
    if (fileInput) fileInput.value = "";

    await loadEvidence(evidenceClaimId);
  } catch (err) {
    setError(err.message);
  } finally {
    setEvidenceBusy(false);
  }
}

  // ADD WARRANTY

  async function addWarranty() {
    const result = await post("warranties", {
      product: "Wireless Headphones",
      expiry_date: "2027-11-24",
      serial_number: "WH-2026-081",
      file_name: "sample-invoice.pdf"
    });

    if (result) {
      setMessage(result.message || "Warranty saved to the demo vault.");
    }
  }

  async function submitCustomWarranty(event) {
    event.preventDefault();
    const result = await post("warranties", {
      product: warrantyProduct,
      expiry_date: warrantyExpiry,
      serial_number: warrantySerial,
      file_name: warrantyFileName
    });
    if (result) {
      setWarrantyProduct("");
      setWarrantyExpiry("");
      setWarrantySerial("");
      setWarrantyFileName("");
      setMessage(result.message || "Warranty saved to Vault.");
    }
  }

  async function toggleWarrantyStatus(item) {
    const nextStatus = item.status === "Claimed" ? "Active" : "Claimed";
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/warranties/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update warranty.");
      await refresh();
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeWarranty(item) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/warranties/${item.id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete warranty.");
      await refresh();
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCustomReminder(event) {
    event.preventDefault();
    const result = await post("reminders", {
      title: reminderTitle,
      due_date: reminderDate,
      notes: reminderNotes,
      claim_id: claim?.claim_id
    });
    if (result) {
      setReminderTitle("");
      setReminderDate("");
      setReminderNotes("");
      setMessage(result.message || "Reminder saved.");
    }
  }

  async function toggleReminderStatus(item) {
    const nextStatus = item.status === "Completed" ? "Pending" : "Completed";
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/reminders/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update reminder.");
      await refresh();
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeReminder(item) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/reminders/${item.id}`, {
        method: "DELETE",
        credentials: "include"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete reminder.");
      await refresh();
      setMessage(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function scanSubscriptions() {
    const result = await post("subscriptions/scan", {});
    if (result) {
      setSubscriptionScan(result);
      setMessage(`Scanned ${result.analyzed_transactions} transactions via Ledger MCP: ${result.traps_found} subscription pattern(s) found.`);
    }
  }

  async function setSubscriptionReminder(trap) {
    setSubscriptionReminderBusy(trap.merchant);
    try {
      const result = await post("reminders", {
        title: `Review / cancel ${trap.merchant} subscription`,
        due_date: trap.estimated_next_renewal,
        notes: `Subscription Trap Detector flagged ${trap.merchant} (${money(trap.monthly_cost)}/mo).`
      });
      if (result) {
        setMessage(
          `Reminder scheduled for ${trap.merchant} on ${result.due_date || trap.estimated_next_renewal}.`
        );
      }
    } finally {
      setSubscriptionReminderBusy(null);
    }
  }

  async function discoverMcpTools() {
    const result = await post("mcp/discover", {});
    if (result) {
      setMcpDiscovery(result.servers || []);
      setMessage("Live MCP tool discovery completed across all 5 stdio servers.");
    }
  }

  async function savePrivacyShield(nextState) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API}/privacy-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextState)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save privacy shield.");
      setPrivacyShield(nextState);
      setMessage(data.message || "Privacy Shield controls updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runChaseMode() {
    const targetClaimId = chaseClaimId || claim?.claim_id || dashboard.claims[0]?.id;
    if (!targetClaimId) {
      setError("Create or select a claim first to run Chase Mode.");
      return;
    }
    const result = await post(`claims/${targetClaimId}/chase`, {
      mode: chaseMode,
      create_reminder: true
    });
    if (result) {
      setChaseResult(result);
      if (claim && String(claim.claim_id) === String(targetClaimId)) {
        setDraft(result.draft || "");
        await loadClaimHistory(targetClaimId);
      }
      setMessage(result.message);
    }
  }

  // LOGOUT

  async function handleLogout() {
    try {
      await fetch(`${API}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      clearAuthenticatedState();
      setCurrentPage("overview");
      setActiveSection("overview");
      if (window.location.pathname !== "/") {
        window.history.replaceState({ page: "overview" }, "", "/");
      }
    }
  }

  // NAVIGATION

  useEffect(() => {
    const handlePopState = () => {
      const pageFromUrl = getPageFromUrl();
      setCurrentPage(pageFromUrl);
      setActiveSection(pageFromUrl);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigateTo(pageKey) {
    const targetPage = VALID_PAGES.has(pageKey) ? pageKey : "overview";
    setCurrentPage(targetPage);
    setActiveSection(targetPage);

    const nextPath = PAGE_PATHS[targetPage] || "/";
    if (window.location.pathname !== nextPath || window.location.search || window.location.hash) {
      window.history.pushState({ page: targetPage }, "", nextPath);
    }
  }

  // SELECT CLAIM FOR REVIEW

  function selectClaim(item) {
    setClaim({
      ...item,
      claim_id: item.id
    });

    setDraft(item.draft || "");
    loadClaimHistory(item.id);
    setMessage(
      item.status === "Needs review"
        ? "Claim selected. Review the draft before deciding."
        : `Viewing claim history. Status: ${item.status}.`
    );
  }

  // PROFILE INITIALS

  const initials = userProfile.full_name
    ? userProfile.full_name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  const metrics = dashboard.metrics || {};
  const monthlySpending = dashboard.monthly_spending || [];
  const maxMonthlySpending = Math.max(
    0,
    ...monthlySpending.map((item) => Number(item.total) || 0)
  );

  // LOADING SCREEN

  if (loading) {
    return (
      <div className="app-loading">
        <LoaderCircle className="loading-spin" size={32} />
        <p>Loading ClaimPilot...</p>
      </div>
    );
  }

  // LOGIN SCREEN

  if (!user) {
    return <Auth onAuthenticated={handleAuthenticated} />;
  }

  // MAIN APPLICATION

  return (
    <div
      className={`shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      onMouseMove={(event) => {
        const nearSidebar = event.clientX <= 72;
        const outsideExpandedSidebar = event.clientX > 270;

        if (nearSidebar) {
          setSidebarOpen(true);
        } else if (outsideExpandedSidebar) {
          setSidebarOpen(false);
        }
      }}
    >
      {/* SIDEBAR */}

      <aside
        className="sidebar"
        ref={sidebarNavigationRef}
        onScroll={(event) => {
          sidebarScrollPosition.current = event.currentTarget.scrollTop;
        }}
      >
        <div className="brand">
          <div className="brand-logo">
            <ShieldCheck size={25} />
          </div>

          <div>
            <b>claimpilot</b>
            <small>CONSUMER DEFENDER</small>
          </div>
        </div>

        <nav className="sidebar-navigation">

          {/* WORKSPACE */}

          <label className="sidebar-section-label">
            WORKSPACE
          </label>

          <button
            className={`nav ${
              currentPage === "overview" ? "active" : ""
            }`}
            onClick={() => navigateTo("overview")}
          >
            <LayoutDashboard size={18} />
            <span>Overview</span>
          </button>

          <button
            className={`nav ${
              currentPage === "priority-actions" ? "active" : ""
            }`}
            onClick={() => navigateTo("priority-actions")}
          >
            <ScanSearch size={18} />
            <span>Money-Leak Radar</span>
          </button>

          <button
            className={`nav ${
              currentPage === "claim-workspace" ? "active" : ""
            }`}
            onClick={() => navigateTo("claim-workspace")}
          >
            <FileText size={18} />
            <span>Claims</span>
          </button>

          {/* FINANCIAL INTELLIGENCE */}

          <label className="sidebar-section-label">
            FINANCIAL INTELLIGENCE
          </label>

          <button
            className={`nav ${
              currentPage === "analytics" ? "active" : ""
            }`}
            onClick={() => navigateTo("analytics")}
          >
            <Activity size={18} />
            <span>Loss Analytics</span>
          </button>

          <button
            className={`nav ${
              currentPage === "refunds" ? "active" : ""
            }`}
            onClick={() => navigateTo("refunds")}
          >
            <Wallet size={18} />
            <span>Refund Recovery Tracker</span>
          </button>

          <button
            className={`nav ${
              currentPage === "evidence-intelligence" ? "active" : ""
            }`}
            onClick={() => navigateTo("evidence-intelligence")}
          >
            <FileText size={18} />
            <span>Evidence Intelligence</span>
          </button>

          {/* FINANCIAL */}

          <label className="sidebar-section-label">
            FINANCIAL
          </label>

          <button
            className={`nav ${
              currentPage === "transactions" ? "active" : ""
            }`}
            onClick={() => navigateTo("transactions")}
          >
            <Receipt size={18} />
            <span>Transactions</span>
          </button>

          {/* INTELLIGENCE & SECURITY */}

          <label className="sidebar-section-label">
            INTELLIGENCE & SECURITY
          </label>

          <button
            className={`nav ${
              currentPage === "privacy-shield" ? "active" : ""
            }`}
            onClick={() => navigateTo("privacy-shield")}
          >
            <LockKeyhole size={18} />
            <span>Privacy Shield</span>
          </button>

          <button
            className={`nav ${
              currentPage === "chase-modes" ? "active" : ""
            }`}
            onClick={() => navigateTo("chase-modes")}
          >
            <Timer size={18} />
            <span>Chase Mode</span>
          </button>

          <button
            className={`nav ${
              currentPage === "mcp-trace" ? "active" : ""
            }`}
            onClick={() => navigateTo("mcp-trace")}
          >
            <Network size={18} />
            <span>MCP Visualizer</span>
          </button>

          <button
            className={`nav ${
              currentPage === "subscription-traps" ? "active" : ""
            }`}
            onClick={() => navigateTo("subscription-traps")}
          >
            <ScanEye size={18} />
            <span>Subscription Trap Detector</span>
          </button>

          <button
            className={`nav ${
              currentPage === "calendar" ? "active" : ""
            }`}
            onClick={() => navigateTo("calendar")}
          >
            <CalendarDays size={18} />
            <span>Calendar</span>
          </button>

          {/* PROTECTION */}

          <label className="sidebar-section-label">
            PROTECTION
          </label>

          <button
            className={`nav ${
              currentPage === "warranty-vault" ? "active" : ""
            }`}
            onClick={() => navigateTo("warranty-vault")}
          >
            <ShieldCheck size={18} />
            <span>Warranty Vault</span>
          </button>

          <button
            className={`nav ${
              currentPage === "reminders" ? "active" : ""
            }`}
            onClick={() => navigateTo("reminders")}
          >
            <Bell size={18} />
            <span>Reminders</span>
          </button>

          {/* PREFERENCES */}

          <label className="sidebar-section-label preferences-label">
            PREFERENCES
          </label>

          <button
            className={`nav ${
              currentPage === "settings" ? "active" : ""
            }`}
            onClick={() => navigateTo("settings")}
          >
            <SettingsIcon size={18} />
            <span>Settings</span>
          </button>

          <button
            className={`nav ${
              currentPage === "help" ? "active" : ""
            }`}
            onClick={() => navigateTo("help")}
          >
            <LifeBuoy size={18} />
            <span>Help & Support</span>
          </button>
        </nav>

        {/* SIDEBAR ACCOUNT AREA */}

        <div className="sidebar-bottom">
          <div className="demo-card">
            <span>
              <i />
              <b>DEMO MODE ON</b>
            </span>

            <p>Seeded sample data. No real accounts connected.</p>
          </div>

          <button
            className="sidebar-account"
            onClick={() => setShowProfile(true)}
            title="Open profile"
          >
            <div className="sidebar-avatar">
              {userProfile.image_url ? (
                <img src={userProfile.image_url} alt="Profile" />
              ) : (
                initials
              )}
            </div>

            <span className="sidebar-account-text">
              <b>{userProfile.full_name || "Your Profile"}</b>
              <small>
                {userProfile.email || user.email || "Individual account"}
              </small>
            </span>

            <UserRound size={16} />
          </button>

          <button
            className="logout-button"
            onClick={handleLogout}
          >
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}

      <main className="main-content">

        {/* TOPBAR */}

        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>›</span>{" "}
            <b>
              {({
                overview: "Overview",
                "priority-actions": "Money-Leak Radar",
                "claim-workspace": "Claims",
                analytics: "Loss Analytics",
                refunds: "Refund Recovery Tracker",
                "evidence-intelligence": "Evidence Intelligence",
                transactions: "Transactions",
                "privacy-shield": "Privacy Shield",
                "chase-modes": "Chase Mode",
                "mcp-trace": "MCP Visualizer",
                "subscription-traps": "Subscription Trap Detector",
                calendar: "Calendar",
                "warranty-vault": "Warranty Vault",
                reminders: "Reminders",
                settings: "Settings",
                help: "Help & Support"
              })[currentPage] || "Overview"}
            </b>
          </div>

          <div className="topbar-actions">
            <span className="demo-pill">
              <i />
              Seeded demo
            </span>

            <button
              onClick={refresh}
              title="Refresh dashboard"
            >
              <RefreshCw size={16} />
            </button>

            <button
              title="View reminders"
              onClick={() => navigateTo("reminders")}
            >
              <Bell size={16} />
            </button>

            <button
              className="top-avatar"
              onClick={() => setShowProfile(true)}
              title="Open my profile"
            >
              {userProfile.image_url ? (
                <img src={userProfile.image_url} alt="Profile" />
              ) : (
                initials
              )}
            </button>
          </div>
        </header>

        {/* SETTINGS / HELP / DASHBOARD PAGE */}

        {currentPage === "settings" ? (
          <SettingsPage
            onOpenProfile={() => setShowProfile(true)}
          />
        ) : currentPage === "help" ? (
          <HelpSupport />
        ) : currentPage === "analytics" ? (
          <section className="page-wrap">
            <ClaimInsights
              view="analytics"
              claims={dashboard.claims}
              monthlySpending={monthlySpending}
              possibleDuplicateLoss={metrics.possible_duplicate_loss || 0}
              onUnauthorized={clearAuthenticatedState}
            />
          </section>
        ) : currentPage === "refunds" ? (
          <section className="page-wrap">
            <ClaimInsights
              view="refunds"
              claims={dashboard.claims}
              onUnauthorized={clearAuthenticatedState}
              onRefundUpdated={refresh}
            />
          </section>
        ) : (

          /* ISOLATED WORKSPACE PAGES */

          <section className="page-wrap" id={currentPage}>

            {/* HERO (Overview only) */}

            {currentPage === "overview" && (
            <div className="hero">
              <div>
                <small>
                  <Sparkles size={13} />
                  YOUR MONEY, UNDER WATCH
                </small>

                <h1>
                  Good morning,{" "}
                  <em>{userProfile.full_name || "Team INFUSION"}.</em>
                </h1>

                <p>
                  Find the issue. Gather the proof. Take the next step — with
                  your approval.
                </p>
              </div>

              <button
                className="primary"
                onClick={investigate}
                disabled={busy}
              >
                <Search size={16} />
                {busy ? "Working..." : "Investigate delayed order"}
                <ArrowUpRight size={15} />
              </button>
            </div>
            )}

            {/* MESSAGE / ERROR */}

            {(message || error) && (
              <div className="global-message">
                <span>{error || message}</span>

                <button
                  onClick={() => {
                    setMessage("");
                    setError("");
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {/* METRICS (Overview summary) */}

            {currentPage === "overview" && (
            <>
            <div className="metrics">
              <Metric
                icon={<Wallet size={22} />}
                label="Potential money at risk"
                value={dashboardUnavailable ? "—" : money(metrics.at_risk)}
                hint="Potential exposure from open claims"
              />

              <Metric
                icon={<CheckCircle2 size={22} />}
                label="Confirmed recovered"
                value={
                  dashboardUnavailable
                    ? "—"
                    : money(metrics.confirmed_recovered)
                }
                hint="Recorded confirmed refunds only"
              />

              <Metric
                icon={<AlertTriangle size={22} />}
                label="Active claims"
                value={dashboardUnavailable ? "—" : metrics.active_claims || 0}
                hint="Open claims from your account"
              />

              <Metric
                icon={<Receipt size={22} />}
                label="Total spending"
                value={
                  dashboardUnavailable
                    ? "—"
                    : money(metrics.total_spending)
                }
                hint={
                  dashboard.transaction_mode === "seeded_demo"
                    ? "Persisted seeded Ledger demo data"
                    : dashboard.transaction_mode
                      ? "Persisted transaction records"
                      : "No transaction records synced"
                }
              />
            </div>

            <div className="two-columns" style={{ marginTop: "20px" }}>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Workspace summary</h2>
                    <p>Jump directly to any ClaimPilot module from the sidebar</p>
                  </div>
                </div>
                <div style={{ display: "grid", gap: "10px" }}>
                  <button type="button" className="record-row" onClick={() => navigateTo("priority-actions")} style={{ width: "100%", textAlign: "left", cursor: "pointer", border: 0, background: "transparent", color: "inherit", font: "inherit" }}>
                    <ScanSearch size={18} />
                    <div>
                      <b>Money-Leak Radar</b>
                      <small>{dashboard.detected_alerts.length} duplicate alert(s) detected</small>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                  <button type="button" className="record-row" onClick={() => navigateTo("claim-workspace")} style={{ width: "100%", textAlign: "left", cursor: "pointer", border: 0, background: "transparent", color: "inherit", font: "inherit" }}>
                    <FileText size={18} />
                    <div>
                      <b>Claims Workspace</b>
                      <small>{dashboard.claims.length} saved claim(s)</small>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                  <button type="button" className="record-row" onClick={() => navigateTo("analytics")} style={{ width: "100%", textAlign: "left", cursor: "pointer", border: 0, background: "transparent", color: "inherit", font: "inherit" }}>
                    <Activity size={18} />
                    <div>
                      <b>Loss Analytics</b>
                      <small>Exposure, pending refunds & spending trends</small>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>

              <section className="panel trust-panel">
                <ShieldCheck size={28} />
                <h2>You stay in control.</h2>
                <p>
                  ClaimPilot prepares the next step. You review and approve
                  before an external action.
                </p>
                <small>✓ Human approval built in</small>
              </section>
            </div>
            </>
            )}

            {/* MONEY-LEAK RADAR */}

            {currentPage === "priority-actions" && (
            <>
            <div className="section-heading">
              <div>
                <h2>Detected alerts</h2>
                <p>Findings calculated from persisted transaction records</p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={checkDuplicates}
                disabled={busy}
              >
                {busy ? "Checking..." : "Check transactions"}
              </button>
            </div>

            {transactionSyncStale && (
              <div className="global-message">
                The latest transaction sync failed. Persisted transaction data
                may be stale; retry the transaction check.
              </div>
            )}

            {dashboardUnavailable ? (
              <section className="panel" id="priority-actions">
                <p className="empty">
                  Detected alerts are unavailable until the dashboard API
                  responds.
                </p>
              </section>
            ) : dashboard.detected_alerts.length ? (
              <div className="issue-grid" id="priority-actions">
                {dashboard.detected_alerts.map((alert) => (
                  <Issue
                    key={alert.transaction_ids.join("-")}
                    icon={<AlertTriangle size={21} />}
                    tone="red"
                    tag="POSSIBLE DUPLICATE"
                    kind="TRANSACTION DETECTION"
                    title={`${alert.transaction_ids.length} matching charges`}
                    desc={`${alert.merchant} · ${alert.date}`}
                    amount={money(alert.possible_duplicate_loss)}
                    sub="Potential exposure · verify before acting"
                    action="Refresh detection"
                    click={checkDuplicates}
                    disabled={busy}
                  />
                ))}
              </div>
            ) : (
              <section className="panel" id="priority-actions">
                <p className="empty">
                  {dashboard.recent_transactions.length
                    ? "No potential duplicate alerts were detected in tracked transactions."
                    : "No persisted transactions yet. Check transactions to sync the configured Ledger source."}
                </p>
              </section>
            )}

            {dashboard.transaction_mode === "seeded_demo" && (
              <p className="empty" style={{ marginTop: "10px" }}>
                Ledger MCP currently provides seeded demo data, not a live
                financial account feed.
              </p>
            )}
            </>
            )}

            {currentPage === "transactions" && (
            <>
            <div className="section-heading">
              <div>
                <h2>Transactions</h2>
                <p>Sync and review persisted Ledger transactions</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={checkDuplicates}
                disabled={busy}
              >
                {busy ? "Checking..." : "Check transactions"}
              </button>
            </div>
            <div className="two-columns" style={{ marginTop: "20px" }}>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Monthly spending</h2>
                    <p>Positive transaction amounts grouped by month</p>
                  </div>
                  {dashboard.metrics.possible_duplicate_loss > 0 && (
                    <span>
                      Possible duplicate exposure:{" "}
                      {money(dashboard.metrics.possible_duplicate_loss)}
                    </span>
                  )}
                </div>

                {dashboardUnavailable ? (
                  <p className="empty">
                    Spending data is unavailable until the dashboard API
                    responds.
                  </p>
                ) : monthlySpending.length ? (
                  <div
                    aria-label="Monthly spending chart"
                    style={{
                      display: "grid",
                      gap: "14px",
                      marginTop: "20px"
                    }}
                  >
                    {monthlySpending.map((item) => {
                      const total = Number(item.total) || 0;
                      const width = maxMonthlySpending
                        ? Math.max(2, (total / maxMonthlySpending) * 100)
                        : 0;
                      const monthLabel = new Intl.DateTimeFormat("en", {
                        month: "short",
                        year: "2-digit"
                      }).format(new Date(`${item.month}-01T00:00:00`));

                      return (
                        <div
                          key={item.month}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "58px minmax(40px, 1fr) auto",
                            alignItems: "center",
                            gap: "10px"
                          }}
                        >
                          <small>{monthLabel}</small>
                          <div
                            style={{
                              height: "12px",
                              overflow: "hidden",
                              background: "#eff6ff",
                              borderRadius: "8px"
                            }}
                          >
                            <div
                              style={{
                                width: `${width}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, #38bdf8, #2563eb)",
                                borderRadius: "8px"
                              }}
                            />
                          </div>
                          <b>{money(total)}</b>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty">
                    No persisted transactions are available to chart.
                  </p>
                )}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent transactions</h2>
                    <p>Latest records saved for your account</p>
                  </div>
                  {dashboard.transaction_last_synced && (
                    <small>
                      Last synced{" "}
                      {formatDateTime(dashboard.transaction_last_synced)}
                    </small>
                  )}
                </div>

                {dashboardUnavailable ? (
                  <p className="empty">
                    Recent transactions are unavailable until the dashboard API
                    responds.
                  </p>
                ) : dashboard.recent_transactions.length ? (
                  dashboard.recent_transactions.map((transaction) => (
                    <div className="activity-row" key={transaction.id}>
                      <b>
                        {transaction.merchant} · {money(transaction.amount)}
                      </b>
                      <small>
                        {transaction.id} · {transaction.date}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="empty">
                    No transaction records are saved yet. Use Check
                    transactions to sync the configured source.
                  </p>
                )}
              </section>
            </div>
            </>
            )}

            {/* CLAIM WORKSPACE */}

            {currentPage === "claim-workspace" && (
              <section className="panel" id="claim-workspace">

                <div className="panel-heading">
                  <div>
                    <h2>Claim workspace</h2>
                    <p>Review actions before they happen</p>
                  </div>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={createTestClaim}
                      disabled={busy}
                      title="Create a unique Needs review claim for development/demo testing"
                    >
                      {busy ? "Creating..." : "+ Create Test Claim (Demo)"}
                    </button>
                    <span>{dashboard.claims.length} claims</span>
                  </div>
                </div>

                {/* CLICKABLE CLAIM RECORDS */}

                {dashboard.claims.map((item, index) => (
                  <button
                    type="button"
                    className="record-row"
                    key={item.id || index}
                    onClick={() => selectClaim(item)}
                    disabled={busy}
                    aria-label={`Select claim for ${item.merchant}, order ${item.order_id}, status ${item.status}`}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                      border: 0,
                      background: "transparent",
                      position: "relative",
                      zIndex: 1,
                      pointerEvents: "auto"
                    }}
                  >
                    <FileText size={19} />

                    <div>
                      <b>
                        {item.merchant} · {item.order_id}
                      </b>

                      <small>{item.issue}</small>
                    </div>

                    <span>{item.status}</span>
                  </button>
                ))}

                {!dashboard.claims.length && (
                  <p className="empty">
                    No claims yet. Investigate a delayed order to create a demo
                    claim.
                  </p>
                )}

                {/* COMPLAINT DRAFT */}

                {claim && (
                  <div className="draft">

                    {claim.delay_finding && (
                      <div
                        className="investigation-context"
                        style={{
                          padding: "14px",
                          marginBottom: "16px",
                          border: "1px solid var(--border, #ddd)",
                          borderRadius: "10px"
                        }}
                      >
                        <h4>Retrieved investigation context</h4>
                        <p>
                          <b>Inbox MCP:</b>{" "}
                          {claim.delay_finding.summary}
                        </p>
                        <p>
                          <b>Ledger MCP:</b>{" "}
                          {claim.transactions?.length
                            ? claim.transactions.map((transaction) =>
                                `${transaction.id} (${money(transaction.amount)})`
                              ).join(", ")
                            : "No matching merchant-and-amount transaction found."}
                        </p>
                        <p>
                          <b>Possible duplicate groups:</b>{" "}
                          {claim.duplicate_alerts?.length || 0}
                        </p>
                        <p>
                          <b>Uploaded evidence:</b>{" "}
                          {claim.uploaded_evidence?.length || 0} file(s) found
                        </p>
                        {claim.policy?.guidance && (
                          <p>
                            <b>Policy MCP (illustrative):</b>{" "}
                            {claim.policy.guidance}
                          </p>
                        )}
                      </div>
                    )}

                    <h3>
                      Complaint draft
                      <small>
                        {" · "}
                        {claim.status === "Needs review"
                          ? "Editable local template · Not sent"
                          : claim.status}
                      </small>
                    </h3>

                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="The generated complaint draft will appear here..."
                      disabled={claim.status !== "Needs review"}
                    />

                    <p>
                      The draft is a local template. Approval records a demo
                      action only; no email or refund is sent.
                    </p>

                    {!["Approved (demo)", "Rejected (demo)", "Resolved", "Closed"].includes(claim.status) && (
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => investigate(claim)}
                          disabled={busy}
                        >
                          <Search size={15} />
                          {busy ? "Investigating..." : "Investigate claim"}
                        </button>
                        {claim.status === "Needs review" && (
                          <>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => decideClaim("approve")}
                              disabled={busy || !draft.trim()}
                            >
                              <CheckCircle2 size={15} />
                              {busy ? "Processing..." : "Approve demo action"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => decideClaim("reject")}
                              disabled={busy}
                            >
                              Reject draft
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    <div className="investigation-history">
                      <h4>Investigation history</h4>
                      {historyBusy ? (
                        <p className="empty">Loading recorded events...</p>
                      ) : claimHistory.length ? (
                        claimHistory.map((event) => (
                          <div className="activity-row" key={event.id}>
                            <b>
                              {event.server} / {event.tool} · {event.status}
                            </b>
                            <small>
                              {event.summary}
                              {" · "}
                              {event.created_at
                                ? formatDateTime(event.created_at)
                                : "Time unavailable"}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p className="empty">
                          No history has been recorded for this claim.
                        </p>
                      )}
                    </div>

                  </div>
                )}

              </section>
            )}

              {/* MCP EXECUTION TRACE */}

              {currentPage === "mcp-trace" && (
              <section className="panel" id="mcp-trace">

                <div className="panel-heading">
                  <div>
                    <h2>MCP execution trace</h2>
                    <p>Dynamic tool discovery, invocations, responses and failures</p>
                  </div>

                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={discoverMcpTools}
                      disabled={busy}
                    >
                      {busy ? "Discovering..." : "Discover MCP tools"}
                    </button>
                    <span className="live-dot">● LIVE LOG</span>
                  </div>
                </div>

                {[
                  { name: "inbox_mcp", desc: "Email evidence & approved drafts" },
                  { name: "ledger_mcp", desc: "Transaction & subscription checks" },
                  { name: "policy_mcp", desc: "Merchant policy lookup" },
                  { name: "calendar_mcp", desc: "Reminder creation" },
                  { name: "vault_mcp", desc: "Warranty records" }
                ].map((srv) => {
                  const disc = mcpDiscovery?.find((s) => s.server === srv.name);
                  return (
                    <div key={srv.name}>
                      <ServerRow
                        name={srv.name}
                        description={
                          disc
                            ? disc.status === "connected"
                              ? `${srv.desc} · Tools: ${disc.tools.map((t) => t.name).join(", ")}`
                              : `${srv.desc} · Error: ${disc.error}`
                            : srv.desc
                        }
                        contacted={
                          disc?.status === "connected" ||
                          dashboard.activity.some((item) => item.server === srv.name)
                        }
                      />
                    </div>
                  );
                })}

                <h4 className="activity-title">
                  <Activity size={14} />
                  Recent tool activity
                </h4>

                {dashboard.activity.slice(0, 10).map((item, index) => (
                  <div
                    className="activity-row"
                    key={item.id || index}
                  >
                    <b>
                      {item.server} / {item.tool} · {String(item.status || "info").toUpperCase()}
                    </b>

                    <small>
                      {String(item.summary || item.status || "").slice(0, 140)}
                    </small>
                  </div>
                ))}

                {!dashboard.activity.length && (
                  <p className="empty">
                    Run an action or click Discover MCP tools to see live MCP calls here.
                  </p>
                )}

              </section>
              )}

            
{/* EVIDENCE INTELLIGENCE */}

{currentPage === "evidence-intelligence" && (
<section className="panel evidence-panel" id="evidence-intelligence">
  <div className="evidence-header">
    <div>
      <span className="evidence-eyebrow">DOCUMENT MANAGEMENT</span>
      <h2>Evidence Intelligence</h2>
      <p>Keep invoices, receipts and supporting documents organized by claim.</p>
    </div>
    <div className="evidence-header-icon">
      <FileText size={25} />
    </div>
  </div>

  <div className="evidence-upload-card">
    <div className="evidence-form-grid">
      <div className="evidence-field">
        <label htmlFor="evidence-claim">Select claim</label>
        <select
          id="evidence-claim"
          value={evidenceClaimId}
          onChange={(event) => setEvidenceClaimId(event.target.value)}
        >
          <option value="">Choose a claim</option>
          {dashboard.claims.map((item) => (
            <option key={item.id} value={item.id}>
              {item.merchant} · {item.order_id}
            </option>
          ))}
        </select>
      </div>

      <div className="evidence-field">
        <label>Choose evidence document</label>

        <label className="evidence-file-picker" htmlFor="evidence-file">
          <input
            id="evidence-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={(event) =>
              setEvidenceFile(event.target.files?.[0] || null)
            }
          />
          <FileText size={20} />
          <span>{evidenceFile ? "Change document" : "Browse files"}</span>
        </label>
      </div>
    </div>

    <div className="evidence-selected-file">
      {evidenceFile ? (
        <>
          <FileText size={19} />
          <div>
            <b>{evidenceFile.name}</b>
            <small>{(evidenceFile.size / 1024).toFixed(1)} KB</small>
          </div>
          <button
            type="button"
            onClick={() => {
              setEvidenceFile(null);
              const input = document.getElementById("evidence-file");
              if (input) input.value = "";
            }}
          >
            Remove
          </button>
        </>
      ) : (
        <span>PDF, PNG, JPG or WEBP · Maximum file size 10 MB</span>
      )}
    </div>

    <button
      className="primary evidence-upload-button"
      type="button"
      onClick={uploadEvidence}
      disabled={evidenceBusy || !evidenceClaimId || !evidenceFile}
    >
      <FileText size={17} />
      {evidenceBusy ? "Uploading document..." : "Upload evidence"}
      <ArrowUpRight size={16} />
    </button>
  </div>

  <div className="evidence-list-header">
    <div>
      <h3>Uploaded documents</h3>
      <p>Your claim-related evidence in one place.</p>
    </div>
    <span className="evidence-count">{evidenceItems.length} files</span>
  </div>

  {!evidenceClaimId ? (
    <div className="evidence-empty">
      <FileText size={25} />
      <b>Select a claim to view documents</b>
      <span>Choose a claim above to see its uploaded evidence.</span>
    </div>
  ) : evidenceItems.length === 0 ? (
    <div className="evidence-empty">
      <FileText size={25} />
      <b>No documents uploaded yet</b>
      <span>Upload an invoice, receipt or other supporting document.</span>
    </div>
  ) : (
    <div className="evidence-document-list">
      {evidenceItems.map((item) => (
        <div className="evidence-document" key={item.id}>
          <div className="evidence-document-icon">
            <FileText size={21} />
          </div>
          <div className="evidence-document-info">
            <b>{item.original_name}</b>
            <small>
              {(item.file_size / 1024).toFixed(1)} KB
              {" · "}
              {item.created_at ? formatDateTime(item.created_at) : "Uploaded"}
            </small>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
  {item.original_name.toLowerCase().endsWith(".pdf") && (
    <button
      type="button"
      className="secondary-button"
      onClick={() => analyzeEvidence(item)}
      disabled={analysisBusyId !== null}
    >
      {analysisBusyId === item.id ? "Analysing..." : "Analyse invoice"}
    </button>
  )}

  <a
    href={`${API}/evidence/${item.id}/download`}
    target="_blank"
    rel="noreferrer"
    className="evidence-download"
  >
    Download <ArrowUpRight size={14} />
  </a>
  {item.report_available && (
    <button
      type="button"
      className="secondary-button"
      onClick={() => downloadSavedReport(item)}
    >
      Download saved report
    </button>
  )}
</div>
        </div>
      ))}
    </div>
  )}

  {evidenceReport && (
    <div className="panel" style={{ marginTop: "20px" }}>
      <h3>Invoice Analysis Report</h3>
      <button
        type="button"
        className="primary-button"
        onClick={downloadInvoiceReport}
      >
        Save and download PDF report
      </button>

      <p>
        File: <b>{evidenceReport.file_name}</b>
      </p>

      <p>
        Overall result:{" "}
        <b>
          {evidenceReport.overall_status === "matched"
            ? "All claim fields matched"
            : evidenceReport.overall_status === "needs_review"
              ? "Mismatch detected — review required"
              : "Some invoice details could not be found"}
        </b>
      </p>

      <div style={{ display: "grid", gap: "12px" }}>
        {Object.values(evidenceReport.comparison).map((field) => (
          <div
            key={field.label}
            style={{
              padding: "12px",
              border: "1px solid var(--border, #ddd)",
              borderRadius: "10px"
            }}
          >
            <b>{field.label}</b>
            <p>Invoice: {field.invoice_value ?? "Not found"}</p>
            <p>Claim: {field.claim_value ?? "Not available"}</p>
            <small>
              {field.status === "match"
                ? "✓ Match"
                : field.status === "mismatch"
                  ? "⚠ Mismatch"
                  : "— Not found"}
            </small>
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: "16px" }}>Other extracted details</h4>
      <p>Invoice date: {evidenceReport.extracted.invoice_date || "Not found"}</p>
      <p>Product: {evidenceReport.extracted.product || "Not found"}</p>
    </div>
  )}
</section>
)}


            {/* SUBSCRIPTION TRAP DETECTOR */}

            {currentPage === "subscription-traps" && (
            <section className="panel" id="subscription-traps" style={{ marginTop: "20px" }}>
              <div className="panel-heading">
                <div>
                  <h2>Subscription Trap Detector</h2>
                  <p>
                    Detects recurring charges, auto-renewal traps, and annualized exposure via Ledger MCP
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={scanSubscriptions}
                  disabled={busy}
                >
                  <ScanEye size={15} />
                  {busy ? "Scanning..." : "Scan subscriptions"}
                </button>
              </div>

              {subscriptionScan ? (
                <>
                  <p style={{ marginBottom: "12px" }}>
                    Analyzed <b>{subscriptionScan.analyzed_transactions}</b> transactions ·{" "}
                    <b>{subscriptionScan.traps_found}</b> recurring pattern(s) · Estimated annual exposure:{" "}
                    <b>{money(subscriptionScan.total_annual_exposure)}</b>{" "}
                    ({subscriptionScan.mode === "seeded_demo" ? "Seeded demo Ledger data" : "Persisted data"})
                  </p>
                  {subscriptionScan.traps?.length ? (
                    subscriptionScan.traps.map((trap) => {
                      const expectedTitle = `review / cancel ${trap.merchant.toLowerCase()} subscription`;
                      const existingReminder = dashboard.reminders.find(
                        (r) =>
                          (r.status || "Pending") !== "Completed" &&
                          String(r.title || "").trim().toLowerCase() === expectedTitle &&
                          r.due_date === trap.estimated_next_renewal
                      );
                      const isSetting = subscriptionReminderBusy === trap.merchant;

                      return (
                        <div className="record-row" key={trap.merchant}>
                          <ScanEye size={18} />
                          <div>
                            <b>
                              {trap.merchant} · {money(trap.monthly_cost)}/mo ({money(trap.annual_exposure)}/yr)
                            </b>
                            <small>
                              Risk: {trap.risk_level} · Next est. renewal: {trap.estimated_next_renewal}
                              {existingReminder ? ` · Reminder scheduled for ${existingReminder.due_date}` : ""}
                              {" · "}
                              {trap.reason}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setSubscriptionReminder(trap)}
                            disabled={busy || Boolean(existingReminder)}
                          >
                            {isSetting
                              ? "Setting reminder..."
                              : existingReminder
                                ? `Scheduled (${existingReminder.due_date})`
                                : "Set reminder"}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="empty">No recurring subscription traps detected.</p>
                  )}
                </>
              ) : (
                <p className="empty">
                  Click Scan subscriptions to invoke Ledger MCP and detect recurring subscription traps.
                </p>
              )}
            </section>
            )}

            {/* INTELLIGENCE & SECURITY: PRIVACY SHIELD & CHASE MODES */}

            {currentPage === "privacy-shield" && (
              <section className="panel" id="privacy-shield">
                <div className="panel-heading">
                  <div>
                    <h2>Privacy Shield</h2>
                    <p>Local-first data boundaries and PII protection controls</p>
                  </div>
                  <LockKeyhole size={20} />
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                    <span>
                      <b>Mask PII in complaint drafts</b>
                      <br />
                      <small>Avoids embedding personal phone/email in generated templates</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={privacyShield.mask_pii_in_drafts}
                      onChange={(e) =>
                        savePrivacyShield({
                          ...privacyShield,
                          mask_pii_in_drafts: e.target.checked
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                    <span>
                      <b>Local-only invoice & MCP processing</b>
                      <br />
                      <small>PyMuPDF extraction & stdio MCP run locally without external uploads</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={privacyShield.local_only_mode}
                      onChange={(e) =>
                        savePrivacyShield({
                          ...privacyShield,
                          local_only_mode: e.target.checked
                        })
                      }
                      disabled={busy}
                    />
                  </label>

                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                    <span>
                      <b>Usage analytics</b>
                      <br />
                      <small>Keep usage telemetry disabled by default</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={privacyShield.analytics_enabled}
                      onChange={(e) =>
                        savePrivacyShield({
                          ...privacyShield,
                          analytics_enabled: e.target.checked
                        })
                      }
                      disabled={busy}
                    />
                  </label>
                </div>

                <p className="empty" style={{ marginTop: "12px" }}>
                  Active boundary: Local SQLite · Local PyMuPDF · Local stdio MCP · No external email/bank credentials stored.
                </p>
              </section>
            )}

            {currentPage === "chase-modes" && (
              <section className="panel" id="chase-modes">
                <div className="panel-heading">
                  <div>
                    <h2>Chase Modes</h2>
                    <p>Prepare escalation follow-ups & Calendar reminders for a claim (demo only)</p>
                  </div>
                  <Timer size={20} />
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  <select
                    value={chaseClaimId || claim?.claim_id || dashboard.claims[0]?.id || ""}
                    onChange={(e) => setChaseClaimId(e.target.value)}
                  >
                    <option value="">Select a claim</option>
                    {dashboard.claims.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.merchant} · {c.order_id} ({c.status})
                      </option>
                    ))}
                  </select>

                  <select
                    value={chaseMode}
                    onChange={(e) => setChaseMode(e.target.value)}
                  >
                    <option value="gentle">Gentle Nudge (+7 day follow-up)</option>
                    <option value="firm">Firm Escalation (+4 day follow-up)</option>
                    <option value="escalation">Deadline Enforcement (+2 day follow-up)</option>
                  </select>

                  <button
                    type="button"
                    className="primary"
                    onClick={runChaseMode}
                    disabled={busy || !dashboard.claims.length}
                  >
                    <Timer size={15} />
                    {busy ? "Running Chase Mode..." : "Run Chase Mode"}
                  </button>
                </div>

                {chaseResult && (
                  <div className="activity-row" style={{ marginTop: "12px" }}>
                    <b>Mode: {chaseResult.chase_mode} · {chaseResult.chase_last_run}</b>
                    <small>{chaseResult.message}</small>
                  </div>
                )}
              </section>
            )}

            {/* WARRANTY VAULT */}

            {currentPage === "warranty-vault" && (
              <section className="panel" id="warranty-vault">

                <div className="panel-heading">
                  <div>
                    <h2>Warranty Vault</h2>
                    <p>Validated by Vault MCP and persisted in SQLite</p>
                  </div>

                  <button
                    className="secondary-button"
                    onClick={addWarranty}
                    disabled={busy}
                  >
                    + Add demo warranty
                  </button>
                </div>

                <form onSubmit={submitCustomWarranty} style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <input
                      type="text"
                      placeholder="Product name"
                      value={warrantyProduct}
                      onChange={(e) => setWarrantyProduct(e.target.value)}
                      required
                    />
                    <input
                      type="date"
                      value={warrantyExpiry}
                      onChange={(e) => setWarrantyExpiry(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px" }}>
                    <input
                      type="text"
                      placeholder="Serial number (optional)"
                      value={warrantySerial}
                      onChange={(e) => setWarrantySerial(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Receipt file name (optional)"
                      value={warrantyFileName}
                      onChange={(e) => setWarrantyFileName(e.target.value)}
                    />
                    <button type="submit" className="secondary-button" disabled={busy}>
                      Save warranty
                    </button>
                  </div>
                </form>

                {dashboard.warranties.map((item, index) => (
                  <div
                    className="record-row"
                    key={item.id || index}
                  >
                    <ShieldCheck size={19} />

                    <div>
                      <b>{item.product} · {item.status || "Active"}</b>

                      <small>
                        {item.file_name ||
                          item.serial_number ||
                          "Saved warranty"}
                        {" · Expires "}
                        {item.expiry_date}
                      </small>
                    </div>

                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => toggleWarrantyStatus(item)}
                        disabled={busy}
                      >
                        {item.status === "Claimed" ? "Mark Active" : "Mark Claimed"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => removeWarranty(item)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

                {!dashboard.warranties.length && (
                  <p className="empty">
                    Add a warranty record above or use + Add demo warranty to test Vault MCP.
                  </p>
                )}

              </section>
            )}

            {(currentPage === "calendar" || currentPage === "reminders") && (
            <section className="panel" id="reminders" style={{ marginTop: "20px" }}>
              <div className="panel-heading">
                <div>
                  <h2>Calendar & Reminders</h2>
                  <p>
                    Reminder details are validated by Calendar MCP and stored in
                    this local database.
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={createReminder}
                  disabled={busy}
                >
                  + Quick demo reminder
                </button>
              </div>

              <form onSubmit={submitCustomReminder} style={{ display: "grid", gridTemplateColumns: "1fr 160px 1fr auto", gap: "8px", marginBottom: "14px" }}>
                <input
                  type="text"
                  placeholder="Reminder title"
                  value={reminderTitle}
                  onChange={(e) => setReminderTitle(e.target.value)}
                  required
                />
                <input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={reminderNotes}
                  onChange={(e) => setReminderNotes(e.target.value)}
                />
                <button type="submit" className="secondary-button" disabled={busy}>
                  Add reminder
                </button>
              </form>

              {dashboard.reminders.length ? (
                dashboard.reminders.map((item) => (
                  <div className="record-row" key={item.id}>
                    <CalendarDays size={18} />
                    <div>
                      <b style={{ textDecoration: item.status === "Completed" ? "line-through" : "none" }}>
                        {item.title}
                      </b>
                      <small>
                        {item.due_date} · {item.status || "Pending"} · {item.notes || "No additional notes"}
                      </small>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => toggleReminderStatus(item)}
                        disabled={busy}
                      >
                        {item.status === "Completed" ? "Reopen" : "Complete"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => removeReminder(item)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty">
                  No reminders saved. Create a follow-up reminder to exercise
                  Calendar MCP.
                </p>
              )}
            </section>
            )}

            {/* FOOTER */}

            <footer className="app-footer">
              <b>CLAIMPILOT · TEAM INFUSION</b>

              <span>
                <Database size={13} />
                Local SQLite · Seeded demo data
              </span>
            </footer>

          </section>
        )}
      </main>

      {/* PROFILE MODAL */}

      {showProfile && (
        <Profile
          onClose={() => setShowProfile(false)}
          onProfileUpdated={(updatedProfile) => {
            setUserProfile((previous) => ({
              ...previous,
              ...updatedProfile
            }));

            setUser((previous) => ({
              ...previous,
              ...updatedProfile
            }));
          }}
        />
      )}

    </div>
  );
}

// METRIC CARD

function Metric({ icon, label, value, hint }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{hint}</span>
    </div>
  );
}

// PRIORITY ACTION CARD

function Issue({
  icon,
  tone,
  tag,
  kind,
  title,
  desc,
  amount,
  sub,
  action,
  click,
  disabled
}) {
  return (
    <article className="issue-card">

      <div className="issue-top">
        <i className={`issue-icon ${tone}`}>{icon}</i>
        <small>{tag}</small>
      </div>

      <small>{kind}</small>
      <h3>{title}</h3>
      <p>{desc}</p>

      <div className="issue-amount">
        <b>{amount}</b>
        <small>{sub}</small>
      </div>

      <button onClick={click} disabled={disabled}>
        {action}
        <ArrowRight size={15} />
      </button>

    </article>
  );
}

// MCP SERVER ROW

function ServerRow({ name, description, contacted }) {
  return (
    <div className="server-row">

      <i className={contacted ? "server-contacted" : ""} />

      <div>
        <b>{name}</b>
        <small>{description}</small>
      </div>

      <span>{contacted ? "RECENT CALL" : "NO RECENT CALL"}</span>

    </div>
  );
}
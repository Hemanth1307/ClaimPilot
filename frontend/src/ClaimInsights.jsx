
import React, { useEffect, useState } from "react";
import {
  BarChart3,
  FileUp,
  Wallet,
  RefreshCw,
  Download,
  CheckCircle2,
  Clock3,
  AlertTriangle
} from "lucide-react";

import "./style.css";
import { formatDateTime } from "./dateTime";

const API = "http://localhost:5000/api";

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

export default function ClaimInsights({
  claims = [],
  onUnauthorized,
  onRefundUpdated,
  view = "analytics",
  monthlySpending = [],
  possibleDuplicateLoss = 0
}) {
  const [refunds, setRefunds] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [selectedClaim, setSelectedClaim] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNotes, setRefundNotes] = useState("");

  const [editingRefundId, setEditingRefundId] = useState(null);
  const [editStatus, setEditStatus] = useState("Pending");
  const [editReference, setEditReference] = useState("");
  const [updatingRefundId, setUpdatingRefundId] = useState(null);

  const [evidenceClaim, setEvidenceClaim] = useState("");
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceList, setEvidenceList] = useState([]);

  const [selectedEvidenceClaim, setSelectedEvidenceClaim] =
    useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: "include",
      ...options
    });

    if (response.status === 401) {
      if (onUnauthorized) {
        onUnauthorized();
      }
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
  }

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [refundData, analyticsData] = await Promise.all([
        request("/refunds"),
        request("/analytics")
      ]);

      if (!refundData || !analyticsData) return;

      setRefunds(refundData.refunds || []);
      setAnalytics(analyticsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createRefund(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      const result = await request("/refunds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          claim_id: Number(selectedClaim),
          amount: Number(refundAmount),
          notes: refundNotes
        })
      });

      if (!result) return;

      setMessage(result.message);
      setRefundAmount("");
      setRefundNotes("");
      setSelectedClaim("");

      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEditRefund(refund) {
    setEditingRefundId(refund.id);
    setEditStatus(refund.status || "Pending");
    setEditReference(refund.reference_number || "");
    setMessage("");
    setError("");
  }

  function cancelEditRefund() {
    setEditingRefundId(null);
    setEditStatus("Pending");
    setEditReference("");
  }

  async function saveRefundUpdate(refund) {
    const trimmedReference = editReference.trim();

    if (editStatus === "Confirmed" && !trimmedReference) {
      setError("Add a refund reference number before confirming recovery.");
      return;
    }

    setUpdatingRefundId(refund.id);
    setMessage("");
    setError("");

    try {
      const result = await request(`/refunds/${refund.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: editStatus,
          reference_number: trimmedReference
        })
      });

      if (!result) return;

      if (result.refund) {
        setRefunds((prev) =>
          prev.map((item) => (item.id === refund.id ? result.refund : item))
        );
      }

      setEditingRefundId(null);
      setMessage(result.message || "Refund status updated.");
      setError("");
      await loadData();
      if (onRefundUpdated) {
        await onRefundUpdated();
      }
    } catch (err) {
      setError(err.message || "Could not update refund status.");
    } finally {
      setUpdatingRefundId(null);
    }
  }

  async function uploadEvidence(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!evidenceClaim || !evidenceFile) {
      setError("Select a claim and a file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", evidenceFile);

    try {
      const result = await request(
        `/claims/${evidenceClaim}/evidence`,
        {
          method: "POST",
          body: formData
        }
      );

      if (!result) return;

      setMessage(result.message);
      setEvidenceFile(null);
      event.target.reset();

      await loadEvidence(evidenceClaim);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadEvidence(claimId) {
    if (!claimId) {
      setEvidenceList([]);
      return;
    }

    try {
      const result = await request(
        `/claims/${claimId}/evidence`
      );

      if (!result) return;

      setEvidenceList(result.evidence || []);
    } catch (err) {
      setError(err.message);
    }
  }

  function selectEvidenceClaim(value) {
    setSelectedEvidenceClaim(value);
    loadEvidence(value);
  }

  async function downloadEvidence(item) {
    try {
      const response = await fetch(
        `${API}/evidence/${item.id}/download`,
        { credentials: "include" }
      );

      if (response.status === 401) {
        if (onUnauthorized) {
          onUnauthorized();
        }
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Download failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = item.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="claim-insights">

      {(message || error) && (
        <div className={error ? "insight-error" : "insight-message"}>
          {error || message}
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* CONSUMER LOSS ANALYTICS */}

      {view === "analytics" && (
        <>
          <section className="insight-panel" id="loss-analytics">
            <div className="insight-heading">
              <div>
                <span className="insight-kicker">FINANCIAL OVERVIEW</span>
                <h2>
                  <BarChart3 size={21} />
                  Consumer Loss Analytics
                </h2>
                <p>Financial figures calculated from your saved records.</p>
              </div>

              <button
                type="button"
                className="insight-refresh"
                onClick={loadData}
                disabled={loading}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>

            <div className="insight-metrics">
              <div className="insight-metric">
                <AlertTriangle size={20} />
                <small>Potential claim exposure</small>
                <strong>{money(analytics.potential_loss)}</strong>
              </div>

              <div className="insight-metric">
                <Clock3 size={20} />
                <small>Pending refunds</small>
                <strong>{money(analytics.pending_refunds)}</strong>
              </div>

              <div className="insight-metric">
                <CheckCircle2 size={20} />
                <small>Confirmed recovered</small>
                <strong>{money(analytics.confirmed_recovered)}</strong>
              </div>

              <div className="insight-metric">
                <Wallet size={20} />
                <small>Total claims</small>
                <strong>{analytics.total_claims || 0}</strong>
              </div>
            </div>

            <p className="insight-note">
              Confirmed recovered amounts include only refund records
              marked Confirmed with a reference number. These are
              user-recorded confirmations, not automatic bank verification.
            </p>
          </section>

          <section className="insight-panel" id="monthly-spending-analytics">
            <div className="insight-heading">
              <div>
                <span className="insight-kicker">SPENDING TRENDS</span>
                <h2>Monthly spending</h2>
                <p>Positive transaction amounts grouped by month</p>
              </div>
              {possibleDuplicateLoss > 0 && (
                <span>
                  Possible duplicate exposure: {money(possibleDuplicateLoss)}
                </span>
              )}
            </div>

            {monthlySpending.length ? (
              <div
                aria-label="Monthly spending chart"
                style={{
                  display: "grid",
                  gap: "14px",
                  marginTop: "20px"
                }}
              >
                {(() => {
                  const maxMonthly = Math.max(
                    0,
                    ...monthlySpending.map((item) => Number(item.total) || 0)
                  );
                  return monthlySpending.map((item) => {
                    const total = Number(item.total) || 0;
                    const width = maxMonthly
                      ? Math.max(2, (total / maxMonthly) * 100)
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
                  });
                })()}
              </div>
            ) : (
              <p className="insight-empty">
                No persisted transactions are available to chart.
              </p>
            )}
          </section>
        </>
      )}

      {/* REFUND RECOVERY TRACKER */}

      {view === "refunds" && (
      <section className="insight-panel" id="refund-tracker">
        <div className="insight-heading">
          <div>
            <span className="insight-kicker">MONEY RECOVERY</span>
            <h2>
              <Wallet size={21} />
              Refund Recovery Tracker
            </h2>
            <p>Create refund records and track their progress.</p>
          </div>
        </div>

        <form className="insight-form" onSubmit={createRefund}>
          <label>
            Select claim
            <select
              value={selectedClaim}
              onChange={(event) => setSelectedClaim(event.target.value)}
              required
            >
              <option value="">Choose a claim</option>
              {claims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.merchant} · {claim.order_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Refund amount (₹)
            <input
              type="number"
              min="1"
              step="0.01"
              value={refundAmount}
              onChange={(event) => setRefundAmount(event.target.value)}
              placeholder="Enter amount"
              required
            />
          </label>

          <label className="insight-wide">
            Notes
            <input
              value={refundNotes}
              onChange={(event) => setRefundNotes(event.target.value)}
              placeholder="Reason or refund details"
              maxLength={1000}
            />
          </label>

          <button
            type="submit"
            className="insight-primary"
            disabled={loading || !claims.length}
          >
            Create refund record
          </button>
        </form>

        <div className="insight-list-heading">
          <h3>Refund records</h3>
          <span>{refunds.length} records</span>
        </div>

        {refunds.length ? (
          <div className="insight-table-wrap">
            <table className="insight-table">
              <thead>
                <tr>
                  <th>Merchant / Order</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {refunds.map((refund) => {
                  const isEditing = editingRefundId === refund.id;
                  const isUpdating = updatingRefundId === refund.id;

                  return (
                    <tr key={refund.id}>
                      <td>
                        <strong>{refund.merchant}</strong>
                        <small>{refund.order_id}</small>
                      </td>
                      <td>{money(refund.amount)}</td>
                      <td>
                        {isEditing ? (
                          <select
                            aria-label={`Refund status for ${refund.order_id}`}
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            disabled={isUpdating}
                          >
                            <option value="Pending">Pending</option>
                            <option value="Processing">Processing</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Rejected">Rejected</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        ) : (
                          <span className={`refund-status ${refund.status.toLowerCase()}`}>
                            {refund.status}
                          </span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            aria-label={`Reference number for ${refund.order_id}`}
                            placeholder={
                              editStatus === "Confirmed"
                                ? "Required for Confirmed"
                                : "Reference (optional)"
                            }
                            value={editReference}
                            onChange={(e) => setEditReference(e.target.value)}
                            disabled={isUpdating}
                            maxLength={150}
                          />
                        ) : (
                          refund.reference_number || "—"
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              className="insight-small-button"
                              onClick={() => saveRefundUpdate(refund)}
                              disabled={isUpdating}
                            >
                              {isUpdating ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              className="insight-small-button"
                              onClick={cancelEditRefund}
                              disabled={isUpdating}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="insight-small-button"
                            onClick={() => startEditRefund(refund)}
                          >
                            Update
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="insight-empty">
            No refund records yet. Create one using a saved claim.
          </p>
        )}
      </section>
      )}

      {/* EVIDENCE INTELLIGENCE */}

      {view === "evidence" && (
      <section className="insight-panel" id="evidence-intelligence">
        <div className="insight-heading">
          <div>
            <span className="insight-kicker">CLAIM DOCUMENTATION</span>
            <h2>
              <FileUp size={21} />
              Evidence Intelligence
            </h2>
            <p>Store invoices, receipts and other supporting files against a claim.</p>
          </div>
        </div>

        <form className="insight-form" onSubmit={uploadEvidence}>
          <label>
            Select claim
            <select
              value={evidenceClaim}
              onChange={(event) => setEvidenceClaim(event.target.value)}
              required
            >
              <option value="">Choose a claim</option>
              {claims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.merchant} · {claim.order_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Evidence file
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(event) =>
                setEvidenceFile(event.target.files?.[0] || null)
              }
              required
            />
          </label>

          <button
            type="submit"
            className="insight-primary"
            disabled={!claims.length}
          >
            <FileUp size={16} />
            Upload evidence
          </button>
        </form>

        <div className="insight-list-heading">
          <h3>View uploaded evidence</h3>
          <select
            value={selectedEvidenceClaim}
            onChange={(event) => selectEvidenceClaim(event.target.value)}
          >
            <option value="">Choose a claim</option>
            {claims.map((claim) => (
              <option key={claim.id} value={claim.id}>
                {claim.merchant} · {claim.order_id}
              </option>
            ))}
          </select>
        </div>

        {evidenceList.length ? (
          <div className="evidence-list">
            {evidenceList.map((item) => (
              <div className="evidence-item" key={item.id}>
                <FileUp size={19} />
                <div>
                  <strong>{item.original_name}</strong>
                  <small>
                    {(item.file_size / 1024).toFixed(1)} KB ·{" "}
                    {item.created_at ? formatDateTime(item.created_at) : "Uploaded"}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => downloadEvidence(item)}
                  title="Download evidence"
                >
                  <Download size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="insight-empty">
            Select a claim to view its uploaded evidence.
          </p>
        )}
      </section>
      )}

    </div>
  );
}

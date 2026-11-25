import React, { useEffect, useState } from "react";
import {
  Bell,
  Mail,
  FileText,
  Wallet,
  CalendarDays,
  ShieldCheck,
  UserRound,
  Save,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Lock,
  Database,
  Download,
  Trash2,
  LogOut,
  RotateCcw
} from "lucide-react";

const API = "http://localhost:5000/api";

const defaultSettings = {
  email_notifications: true,
  claim_updates: true,
  refund_updates: true,
  reminder_notifications: true,
  security_alerts: true
};

const defaultPrivacy = {
  analytics_enabled: false,
  personalized_recommendations: true
};

export default function SettingsPage({ onOpenProfile }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [savedSettings, setSavedSettings] = useState(defaultSettings);

  const [privacy, setPrivacy] = useState(defaultPrivacy);
  const [savedPrivacy, setSavedPrivacy] = useState(defaultPrivacy);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadAllSettings();
  }, []);

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: "include",
      ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  }

  async function loadAllSettings() {
    try {
      setLoading(true);
      setError("");

      const [settingsData, privacyData, profileData] =
        await Promise.all([
          request("/settings"),
          request("/privacy-settings"),
          request("/profile")
        ]);

      const loadedSettings = {
        email_notifications: Boolean(settingsData.email_notifications),
        claim_updates: Boolean(settingsData.claim_updates),
        refund_updates: Boolean(settingsData.refund_updates),
        reminder_notifications: Boolean(
          settingsData.reminder_notifications
        ),
        security_alerts: Boolean(settingsData.security_alerts)
      };

      const loadedPrivacy = {
        analytics_enabled: Boolean(privacyData.analytics_enabled),
        personalized_recommendations: Boolean(
          privacyData.personalized_recommendations
        )
      };

      setSettings(loadedSettings);
      setSavedSettings(loadedSettings);
      setPrivacy(loadedPrivacy);
      setSavedPrivacy(loadedPrivacy);
      setEmail(profileData.email || "");
    } catch (err) {
      setError(err.message || "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSetting(key) {
    setSettings((previous) => ({
      ...previous,
      [key]: !previous[key]
    }));
    setMessage("");
    setError("");
  }

  function togglePrivacy(key) {
    setPrivacy((previous) => ({
      ...previous,
      [key]: !previous[key]
    }));
    setMessage("");
    setError("");
  }

  async function saveSettings() {
    try {
      setSaving(true);
      setMessage("");
      setError("");

      const data = await request("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });

      setSavedSettings({ ...settings });
      setMessage(data.message || "Notification preferences saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePrivacy() {
    try {
      setSavingPrivacy(true);
      setMessage("");
      setError("");

      const data = await request("/privacy-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(privacy)
      });

      setSavedPrivacy({ ...privacy });
      setMessage(data.message || "Privacy preferences saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPrivacy(false);
    }
  }

  function resetNotifications() {
    setSettings({ ...defaultSettings });
    setMessage("Default notification preferences selected. Save to apply.");
    setError("");
  }

  async function downloadMyData() {
    try {
      setExporting(true);
      setMessage("");
      setError("");

      const response = await fetch(`${API}/account/export`, {
        credentials: "include"
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not export your data.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "claimpilot-my-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setMessage("Your data export has been downloaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    try {
      await request("/auth/logout", { method: "POST" });
      window.location.reload();
    } catch (err) {
      setError(err.message || "Could not sign out.");
    }
  }

  async function deleteAccount() {
    if (deleteText !== "DELETE") {
      setError('Type DELETE exactly to confirm account deletion.');
      return;
    }

    try {
      setDeleting(true);
      setError("");

      await request("/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteText })
      });

      window.location.reload();
    } catch (err) {
      setError(err.message || "Could not delete your account.");
    } finally {
      setDeleting(false);
    }
  }

  const notificationItems = [
    {
      key: "email_notifications",
      title: "Email notifications",
      description: "Receive important updates through email.",
      icon: Mail
    },
    {
      key: "claim_updates",
      title: "Claim updates",
      description: "Get notified about claim progress and status.",
      icon: FileText
    },
    {
      key: "refund_updates",
      title: "Refund updates",
      description: "Stay informed about pending and confirmed refunds.",
      icon: Wallet
    },
    {
      key: "reminder_notifications",
      title: "Reminder notifications",
      description: "Receive reminders about renewals and important dates.",
      icon: CalendarDays
    },
    {
      key: "security_alerts",
      title: "Security alerts",
      description: "Receive important account security notifications.",
      icon: ShieldCheck
    }
  ];

  if (loading) {
    return (
      <div className="settings-loading">
        <LoaderCircle className="loading-spin" size={28} />
        <p>Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Manage your preferences, privacy and account data.</p>
      </div>

      {message && (
        <div className="settings-message">
          <CheckCircle2 size={18} />
          {message}
        </div>
      )}

      {error && (
        <div className="settings-error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* NOTIFICATION PREFERENCES */}
      <section className="settings-card">
        <div className="settings-section-heading">
          <div className="settings-section-icon">
            <Bell size={24} />
          </div>
          <div>
            <h2>Notification preferences</h2>
            <p>Choose which updates you want to receive.</p>
          </div>
        </div>

        <div className="settings-options">
          {notificationItems.map((item) => {
            const Icon = item.icon;

            return (
              <div className="settings-option" key={item.key}>
                <div className="settings-option-icon">
                  <Icon size={23} />
                </div>

                <div className="settings-option-content">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>

                <label className="settings-switch">
                  <input
                    type="checkbox"
                    checked={settings[item.key]}
                    onChange={() => toggleSetting(item.key)}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
            );
          })}
        </div>

        <div className="settings-save-actions">
          <span>
            {JSON.stringify(settings) === JSON.stringify(savedSettings)
              ? "All preferences are saved."
              : "You have unsaved changes."}
          </span>

          <button
            className="settings-reset-button"
            onClick={resetNotifications}
            type="button"
          >
            <RotateCcw size={16} />
            Reset defaults
          </button>

          <button
            className="settings-primary-button"
            onClick={saveSettings}
            disabled={
              saving ||
              JSON.stringify(settings) === JSON.stringify(savedSettings)
            }
            type="button"
          >
            {saving ? (
              <LoaderCircle className="loading-spin" size={17} />
            ) : (
              <Save size={17} />
            )}
            Save preferences
          </button>
        </div>
      </section>

      {/* PROFILE INFORMATION */}
      <section className="settings-card settings-profile-card">
        <div className="settings-section-heading">
          <div className="settings-section-icon">
            <UserRound size={24} />
          </div>
          <div>
            <h2>Profile information</h2>
            <p>Update your name, email, phone number, location and profile photo.</p>
            {email && <small>{email}</small>}
          </div>
        </div>

        <button
          className="settings-outline-button"
          onClick={onOpenProfile}
          type="button"
        >
          <UserRound size={18} />
          Manage profile
        </button>
      </section>

      {/* PRIVACY PREFERENCES */}
      <section className="settings-card">
        <div className="settings-section-heading">
          <div className="settings-section-icon">
            <Lock size={24} />
          </div>
          <div>
            <h2>Privacy preferences</h2>
            <p>Control optional data use and personalization.</p>
          </div>
        </div>

        <div className="settings-option">
          <div className="settings-option-icon">
            <Database size={22} />
          </div>
          <div className="settings-option-content">
            <h3>Usage analytics</h3>
            <p>Allow ClaimPilot to use optional usage information to improve the demo.</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={privacy.analytics_enabled}
              onChange={() => togglePrivacy("analytics_enabled")}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div className="settings-option">
          <div className="settings-option-icon">
            <UserRound size={22} />
          </div>
          <div className="settings-option-content">
            <h3>Personalized recommendations</h3>
            <p>Allow ClaimPilot to tailor suggestions using your app activity.</p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={privacy.personalized_recommendations}
              onChange={() =>
                togglePrivacy("personalized_recommendations")
              }
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div className="settings-save-actions">
          <span>
            {JSON.stringify(privacy) === JSON.stringify(savedPrivacy)
              ? "Privacy preferences are saved."
              : "You have unsaved changes."}
          </span>

          <button
            className="settings-primary-button"
            onClick={savePrivacy}
            disabled={
              savingPrivacy ||
              JSON.stringify(privacy) === JSON.stringify(savedPrivacy)
            }
            type="button"
          >
            {savingPrivacy ? (
              <LoaderCircle className="loading-spin" size={17} />
            ) : (
              <Save size={17} />
            )}
            Save privacy preferences
          </button>
        </div>

        <p className="settings-demo-note">
          These preferences are stored in your ClaimPilot account. They do not
          represent a legal consent-management system.
        </p>
      </section>

      {/* DATA MANAGEMENT */}
      <section className="settings-card">
        <div className="settings-section-heading">
          <div className="settings-section-icon">
            <Database size={24} />
          </div>
          <div>
            <h2>Data management</h2>
            <p>Download a copy of the information associated with your account.</p>
          </div>
        </div>

        <div className="settings-option">
          <div className="settings-option-icon">
            <Download size={22} />
          </div>
          <div className="settings-option-content">
            <h3>Download my data</h3>
            <p>Export your profile, claims, refunds, reminders and other available records.</p>
          </div>
          <button
            className="settings-outline-button"
            onClick={downloadMyData}
            disabled={exporting}
            type="button"
          >
            {exporting ? (
              <LoaderCircle className="loading-spin" size={17} />
            ) : (
              <Download size={17} />
            )}
            Download
          </button>
        </div>
      </section>

      {/* ACCOUNT MANAGEMENT */}
      <section className="settings-card">
        <div className="settings-section-heading">
          <div className="settings-section-icon">
            <UserRound size={24} />
          </div>
          <div>
            <h2>Account management</h2>
            <p>Manage your ClaimPilot account.</p>
          </div>
        </div>

        <div className="settings-option">
          <div className="settings-option-icon">
            <LogOut size={22} />
          </div>
          <div className="settings-option-content">
            <h3>Sign out</h3>
            <p>Sign out of your current ClaimPilot session.</p>
          </div>
          <button
            className="settings-outline-button"
            onClick={signOut}
            type="button"
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>

        <div className="settings-delete-area">
          <div>
            <h3>Delete account</h3>
            <p>
              Permanently delete your account and its associated database
              records. This action cannot be undone.
            </p>
          </div>

          {!confirmDelete ? (
            <button
              className="settings-danger-button"
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              <Trash2 size={17} />
              Delete account
            </button>
          ) : (
            <div className="settings-delete-confirm">
              <p>
                Type <strong>DELETE</strong> to confirm permanent deletion.
              </p>
              <input
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                placeholder="Type DELETE"
              />
              <div>
                <button
                  className="settings-outline-button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteText("");
                    setError("");
                  }}
                  type="button"
                >
                  Cancel
                </button>

                <button
                  className="settings-danger-button"
                  onClick={deleteAccount}
                  disabled={deleting || deleteText !== "DELETE"}
                  type="button"
                >
                  {deleting ? "Deleting..." : "Permanently delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <p className="settings-demo-note">
        Actual email and push notification delivery is not enabled in this demo.
      </p>
    </div>
  );
}
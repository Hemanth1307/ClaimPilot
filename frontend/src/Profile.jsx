
import React, { useEffect, useRef, useState } from "react";
import {
  UserRound, Mail, Phone, MapPin, Camera, Upload,
  Save, X, Pencil, LoaderCircle, ShieldCheck,
  CheckCircle2
} from "lucide-react";
import "./Profile.css";

const API = "http://localhost:5000/api";

const empty = {
  full_name: "",
  email: "",
  phone: "",
  location: "",
  image_url: ""
};

export default function Profile({ onClose, onProfileUpdated, fullPage = false }) {
  const [profile, setProfile] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [photoMenu, setPhotoMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    loadProfile();
    return () => stopCamera();
  }, []);

  async function loadProfile() {
    try {
      setLoading(true);
      const response = await fetch(`${API}/profile`, {
        credentials: "include"
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Could not load profile.");

      setProfile({ ...empty, ...data });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function change(e) {
    setProfile(old => ({ ...old, [e.target.name]: e.target.value }));
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const image = new Image();

        image.onload = () => {
          const scale = Math.min(1, 900 / image.width, 900 / image.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };

        image.onerror = () => reject(new Error("Invalid image."));
        image.src = reader.result;
      };

      reader.onerror = () => reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadPicture(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError("");
    setMessage("");

    if (!file.type.startsWith("image/")) {
      setError("Select an image file.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8 MB.");
      return;
    }

    try {
      const image_url = await compressImage(file);
      setProfile(old => ({ ...old, image_url }));
      setEditing(true);
      setMessage("Picture selected. Save your changes to keep it.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function openCamera() {
    setPhotoMenu(false);
    setError("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is unavailable. Use localhost or HTTPS.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });

      streamRef.current = stream;
      setCameraOpen(true);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access in your browser."
          : err.message || "Could not open camera."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth) {
      setError("Camera is not ready.");
      return;
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 900 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    canvas.getContext("2d").drawImage(
      video, 0, 0, canvas.width, canvas.height
    );

    setProfile(old => ({
      ...old,
      image_url: canvas.toDataURL("image/jpeg", 0.78)
    }));

    setEditing(true);
    setMessage("Photo captured. Save your changes to keep it.");
    stopCamera();
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API}/profile`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save profile.");

      setProfile({ ...empty, ...data.profile });
      setEditing(false);
      setMessage("Profile saved successfully.");
      onProfileUpdated?.(data.profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const initials = profile.full_name
    ? profile.full_name.trim().split(/\s+/).map(x => x[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  const content = (
    <section className={`profile-panel ${fullPage ? "profile-panel-fullpage" : ""}`}>
      <div className="profile-header">
        <div>
          <span className="profile-eyebrow">ACCOUNT SETTINGS</span>
          <h2>My Profile</h2>
          <p>Manage your personal information.</p>
        </div>
        <button type="button" className="profile-close" onClick={onClose}>
          <X size={19} />
        </button>
      </div>

      {loading ? (
        <div className="profile-loading">
          <LoaderCircle className="profile-spinner" />
          Loading profile...
        </div>
      ) : (
        <>
          <div className="profile-identity">
            <div className="profile-photo-container">
              <button
                type="button"
                className="profile-photo profile-photo-clickable"
                onClick={() => setPhotoMenu(v => !v)}
                aria-label="Change profile picture"
              >
                {profile.image_url
                  ? <img src={profile.image_url} alt="Profile" />
                  : <span>{initials}</span>}
              </button>

              <button
                type="button"
                className="profile-photo-camera-icon"
                onClick={() => setPhotoMenu(v => !v)}
                aria-label="Change picture"
              >
                <Camera size={15} />
              </button>

              {photoMenu && (
                <div className="profile-photo-menu">
                  <button type="button" onClick={() => fileRef.current?.click()}>
                    <Upload size={16} /> Upload picture
                  </button>
                  <button type="button" onClick={openCamera}>
                    <Camera size={16} /> Take photo
                  </button>
                </div>
              )}

              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/*"
                onChange={uploadPicture}
              />
            </div>

            <div className="profile-identity-info">
              <h3>{profile.full_name}</h3>
              <p>{profile.email}</p>
              <span className="profile-status"><i /> Personal account</span>
            </div>
          </div>

          {cameraOpen && (
            <div className="profile-camera-box">
              <video ref={videoRef} autoPlay muted playsInline />
              <div className="profile-camera-actions">
                <button type="button" className="profile-cancel" onClick={stopCamera}>Cancel</button>
                <button type="button" className="profile-save" onClick={capturePhoto}>
                  <Camera size={15} /> Capture photo
                </button>
              </div>
            </div>
          )}

          {message && <div className="profile-success"><CheckCircle2 size={16} />{message}</div>}
          {error && <div className="profile-error">{error}</div>}

          <form onSubmit={save}>
            <div className="profile-form-heading">
              <div>
                <h3>Personal information</h3>
                <p>Your details are private to your account.</p>
              </div>

              {!editing && (
                <button
                  type="button"
                  className="profile-edit"
                  onClick={() => {
                    setEditing(true);
                    setMessage("");
                    setError("");
                  }}
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
            </div>

            <Field label="Full name" name="full_name" value={profile.full_name} onChange={change} icon={<UserRound />} disabled={!editing} required />
            <Field label="Email address" name="email" value={profile.email} onChange={change} icon={<Mail />} disabled={!editing} type="email" required />
            <Field label="Phone number" name="phone" value={profile.phone} onChange={change} icon={<Phone />} disabled={!editing} />
            <Field label="Location" name="location" value={profile.location} onChange={change} icon={<MapPin />} disabled={!editing} />

            {editing && (
              <div className="profile-actions">
                <button type="button" className="profile-cancel" onClick={loadProfile} disabled={saving}>Cancel</button>
                <button type="submit" className="profile-save" disabled={saving}>
                  {saving ? <LoaderCircle className="profile-spinner" size={15} /> : <Save size={15} />}
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            )}
          </form>

          <div className="profile-security-note">
            <ShieldCheck size={21} />
            <div>
              <b>Your account is protected</b>
              <p>Your profile belongs to your signed-in account. Your password is never displayed here.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );

  if (fullPage) {
    return <div className="profile-page">{content}</div>;
  }

  return (
    <div className="profile-overlay" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      {content}
    </div>
  );
}

function Field({ label, name, value, onChange, icon, disabled, type = "text", required = false }) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      <div className="profile-input-wrap">
        {icon}
        <input
          name={name}
          type={type}
          value={value || ""}
          onChange={onChange}
          disabled={disabled}
          required={required}
        />
      </div>
    </label>
  );
}

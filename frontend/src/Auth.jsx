
import React, { useEffect, useRef, useState } from "react";

import {
  ShieldCheck,
  Mail,
  LockKeyhole,
  UserRound,
  Eye,
  EyeOff,
  ArrowRight,
  LoaderCircle
} from "lucide-react";

import "./Auth.css";

const API = "http://localhost:5000/api";
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID;


// =====================================================
// MAIN AUTH COMPONENT
// =====================================================

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState("");

  const googleButtonRef = useRef(null);

  // ===================================================
  // EMAIL LOGIN AND REGISTRATION
  // ===================================================

  async function submit(e) {
    e.preventDefault();

    setError("");
    setLoading(true);

    const endpoint =
      mode === "login" ? "login" : "register";

    const body =
      mode === "login"
        ? {
            email,
            password
          }
        : {
            full_name: fullName,
            email,
            password
          };

    try {
      const response = await fetch(
        `${API}/auth/${endpoint}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Authentication failed."
        );
      }

      if (!data.user) {
        throw new Error(
          "User information was not returned by the server."
        );
      }

      await onAuthenticated();

    } catch (err) {
      setError(
        err.message || "Could not connect to ClaimPilot."
      );
    } finally {
      setLoading(false);
    }
  }


  // ===================================================
  // GOOGLE SIGN-IN CALLBACK
  // ===================================================

  async function handleGoogleCredential(response) {
    if (!response || !response.credential) {
      setError(
        "Google did not return a valid login credential."
      );
      return;
    }

    setError("");
    setGoogleLoading(true);

    try {
      const result = await fetch(
        `${API}/auth/google`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            credential: response.credential
          })
        }
      );

      const data = await result.json();

      if (!result.ok) {
        throw new Error(
          data.error || "Google authentication failed."
        );
      }

      if (!data.user) {
        throw new Error(
          "The server did not return user information."
        );
      }

      await onAuthenticated();

    } catch (err) {
      setError(
        err.message || "Google sign-in failed."
      );
    } finally {
      setGoogleLoading(false);
    }
  }


  // ===================================================
  // INITIALIZE GOOGLE IDENTITY SERVICES
  // ===================================================

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError(
        "Google Sign-In is not configured. Check frontend/.env."
      );
      return;
    }

    let cancelled = false;
    let script = null;

    function initializeGoogle() {
      if (
        cancelled ||
        !window.google?.accounts?.id ||
        !googleButtonRef.current
      ) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });

      googleButtonRef.current.innerHTML = "";

      window.google.accounts.id.renderButton(
        googleButtonRef.current,
        {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          logo_alignment: "left",
          width: 350
        }
      );
    }

    if (window.google?.accounts?.id) {
      initializeGoogle();
    } else {
      script = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );

      if (!script) {
        script = document.createElement("script");

        script.src =
          "https://accounts.google.com/gsi/client";

        script.async = true;
        script.defer = true;

        document.head.appendChild(script);
      }

      const onLoad = () => initializeGoogle();

      script.addEventListener("load", onLoad);

      return () => {
        cancelled = true;
        script.removeEventListener("load", onLoad);
      };
    }

    return () => {
      cancelled = true;
    };

  }, []);


  // ===================================================
  // SWITCH LOGIN / REGISTER
  // ===================================================

  function switchMode() {
    setMode((previous) =>
      previous === "login" ? "register" : "login"
    );

    setError("");
    setPassword("");
    setShowPassword(false);
  }


  // ===================================================
  // UI
  // ===================================================

  return (
    <div className="auth-page">

      {/* LEFT SIDE */}

      <section className="auth-left">

        <div className="auth-brand">

          <div className="auth-logo">
            <ShieldCheck size={29} />
          </div>

          <div>
            <b>claimpilot</b>
            <small>CONSUMER DEFENDER</small>
          </div>

        </div>


        <div className="auth-message">

          <span>YOUR MONEY, UNDER WATCH</span>

          <h1>
            Your money.
            <br />
            <em>Your protection.</em>
          </h1>

          <p>
            Detect suspicious charges, track delayed orders,
            protect warranties and stay ahead of renewals.
          </p>

          <div className="auth-live-status">
            <span className="auth-live-dot" />
            LIVE FINANCIAL PROTECTION
          </div>

          <VaultScene />

        </div>


        <div className="auth-features">

          <div>
            <ShieldCheck />
            <span>Stay in control of your money</span>
          </div>

          <div>
            <LockKeyhole />
            <span>Your own private account</span>
          </div>

          <div>
            <ArrowRight />
            <span>Review actions before approval</span>
          </div>

        </div>


        <small className="auth-footer">
          CLAIMPILOT · TEAM INFUSION
        </small>

      </section>


      {/* RIGHT SIDE */}

      <section className="auth-right">

        <form
          className="auth-card"
          onSubmit={submit}
        >

          <div className="auth-card-heading">

            <span>WELCOME TO CLAIMPILOT</span>

            <h2>
              {mode === "login"
                ? "Welcome back"
                : "Create your account"}
            </h2>

            <p>
              {mode === "login"
                ? "Log in to continue to your dashboard."
                : "Create your personal consumer protection account."}
            </p>

          </div>


          {/* FULL NAME */}

          {mode === "register" && (

            <label className="auth-field">

              <span>Full name</span>

              <div>
                <UserRound size={17} />

                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) =>
                    setFullName(e.target.value)
                  }
                  autoComplete="name"
                  required
                />
              </div>

            </label>

          )}


          {/* EMAIL */}

          <label className="auth-field">

            <span>Email address</span>

            <div>
              <Mail size={17} />

              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                autoComplete="email"
                required
              />
            </div>

          </label>


          {/* PASSWORD */}

          <label className="auth-field">

            <span>Password</span>

            <div>
              <LockKeyhole size={17} />

              <input
                type={
                  showPassword ? "text" : "password"
                }
                placeholder="Enter your password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                minLength={8}
                required
              />

              <button
                type="button"
                className="auth-eye"
                onClick={() =>
                  setShowPassword(!showPassword)
                }
                aria-label="Toggle password visibility"
              >
                {showPassword
                  ? <EyeOff size={17} />
                  : <Eye size={17} />}
              </button>

            </div>

          </label>


          {mode === "register" && (
            <p className="auth-password-note">
              Use at least 8 characters.
            </p>
          )}


          {/* ERROR */}

          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}


          {/* EMAIL SUBMIT */}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || googleLoading}
          >

            {loading ? (
              <>
                <LoaderCircle
                  className="auth-spinner"
                  size={18}
                />
                Please wait...
              </>
            ) : (
              <>
                {mode === "login"
                  ? "Log in"
                  : "Create account"}

                <ArrowRight size={17} />
              </>
            )}

          </button>


          {/* DIVIDER */}

          <div className="auth-divider">
            <span />
            <small>OR CONTINUE WITH</small>
            <span />
          </div>


          {/* GOOGLE BUTTON */}

          <div className="auth-google-wrapper">

            <div
              ref={googleButtonRef}
              className="auth-google-button"
            />

            {googleLoading && (
              <div className="auth-google-loading">
                <LoaderCircle
                  className="auth-spinner"
                  size={17}
                />
                Signing in with Google...
              </div>
            )}

            {!GOOGLE_CLIENT_ID && (
              <div className="auth-error">
                Google Sign-In is not configured.
                Check VITE_GOOGLE_CLIENT_ID in frontend/.env.
              </div>
            )}

          </div>


          {/* SWITCH */}

          <div className="auth-switch">

            {mode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}

            <button
              type="button"
              onClick={switchMode}
            >
              {mode === "login"
                ? "Create account"
                : "Log in"}
            </button>

          </div>


          {/* SECURITY */}

          <div className="auth-security">
            <LockKeyhole size={15} />
            Your account is protected with secure authentication.
          </div>

        </form>

      </section>

    </div>
  );
}


// =====================================================
// CSS 3D SECURITY VAULT
// =====================================================

function VaultScene() {
  return (

    <div className="vault-scene">

      <div className="vault-glow" />

      <div className="vault-orbit orbit-one" />
      <div className="vault-orbit orbit-two" />
      <div className="vault-orbit orbit-three" />


      {/* LEFT FLOATING CARD */}

      <div className="vault-card vault-card-left">

        <span>ACCOUNT PROTECTED</span>

        <div className="vault-card-line" />
        <div className="vault-card-line short" />

      </div>


      {/* RIGHT FLOATING CARD */}

      <div className="vault-card vault-card-right">

        <span>FINANCIAL HEALTH</span>

        <div className="vault-bars">

          {[35, 55, 42, 75, 60, 90, 70].map(
            (height, index) => (
              <i
                key={index}
                style={{ height: `${height}%` }}
              />
            )
          )}

        </div>

      </div>


      {/* MAIN SHIELD */}

      <div className="vault-shield">

        <div className="vault-shield-inner">
          <ShieldCheck
            size={76}
            strokeWidth={1.5}
          />
        </div>

      </div>


      {/* PARTICLES */}

      <div className="vault-particle particle-one" />
      <div className="vault-particle particle-two" />
      <div className="vault-particle particle-three" />
      <div className="vault-particle particle-four" />

    </div>

  );
}

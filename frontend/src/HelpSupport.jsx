
import React, { useEffect, useState } from "react";
import { formatDateTime } from "./dateTime";
import {
  LifeBuoy,
  Search,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Send,
  Ticket,
  Clock,
  CheckCircle2,
  LoaderCircle,
  FileText,
  BookOpen,
  ShieldCheck,
  Bug,
  HelpCircle
} from "lucide-react";

import "./style.css";

const API = "http://localhost:5000/api";

const faqs = [
  {
    category: "Getting Started",
    question: "What is ClaimPilot?",
    answer:
      "ClaimPilot is a consumer protection platform that helps users identify potential financial losses, investigate delayed orders, organize evidence and manage consumer claims."
  },
  {
    category: "Getting Started",
    question: "How do I get started?",
    answer:
      "Log in to your account and open the dashboard. Review your overview, explore Money-Leak Radar, investigate a delayed order and review the evidence and claim information provided."
  },
  {
    category: "Getting Started",
    question: "What is the dashboard?",
    answer:
      "The dashboard provides an overview of your claims, transactions, reminders, warranties and available financial insights."
  },
  {
    category: "Claims",
    question: "How do I investigate a delayed order?",
    answer:
      "Open Money-Leak Radar or the dashboard and select Investigate delayed order. ClaimPilot runs the configured investigation workflow and prepares information and a complaint draft for your review."
  },
  {
    category: "Claims",
    question: "Does ClaimPilot send complaints automatically?",
    answer:
      "No. In the current demo, you review and approve a complaint draft. Approval records a demo action; it does not send an actual email."
  },
  {
    category: "Claims",
    question: "What is Evidence Intelligence?",
    answer:
      "Evidence Intelligence helps organize and retrieve relevant evidence associated with a consumer claim. Always review the retrieved information before using it."
  },
  {
    category: "Claims",
    question: "What is the MCP workflow?",
    answer:
      "ClaimPilot uses configured MCP integrations to connect investigation tasks with relevant tools and data sources. The available integrations and their actual capabilities depend on the running project configuration."
  },
  {
    category: "Refunds",
    question: "How can I track a refund?",
    answer:
      "Review the refund and claim information available in your dashboard. Treat a refund as recovered only when its status is confirmed."
  },
  {
    category: "Refunds",
    question: "Does ClaimPilot guarantee a refund?",
    answer:
      "No. ClaimPilot helps organize information and prepare claims. Refund decisions are made by the relevant merchant or service provider."
  },
  {
    category: "Transactions",
    question: "How does duplicate transaction detection work?",
    answer:
      "ClaimPilot uses its configured ledger workflow to check transaction records for potentially duplicated charges. Review the transaction evidence before taking action."
  },
  {
    category: "Warranty",
    question: "How do I store a warranty?",
    answer:
      "Open Warranty Vault and add the available product and purchase information. Your saved warranty records can be reviewed in the application."
  },
  {
    category: "Account",
    question: "How do I update my profile?",
    answer:
      "Select your profile photo in the sidebar or top bar to open your profile and manage the available account details."
  },
  {
    category: "Account",
    question: "How do I manage notifications?",
    answer:
      "Open Settings and update the notification preferences available in your account."
  },
  {
    category: "Technical issue",
    question: "Why is my dashboard not loading?",
    answer:
      "Check that the Flask backend and React frontend are running. Make sure the API address is correct and that you are logged in. Check the browser console and backend terminal for errors."
  },
  {
    category: "Technical issue",
    question: "Why can't I submit a support request?",
    answer:
      "Make sure you are logged in and have entered a subject and description. Check that the backend is running and that the support ticket API is responding."
  }
];

const categories = [
  "Account",
  "Claims",
  "Refunds",
  "Transactions",
  "Warranty",
  "Technical issue",
  "Bug report",
  "Other"
];

const guides = [
  {
    title: "Dashboard",
    description:
      "Understand your claims, transactions, reminders and financial overview.",
    steps: [
      "Log in to ClaimPilot.",
      "Open the Overview page.",
      "Review your dashboard metrics and recent activity.",
      "Select the relevant section to investigate further."
    ]
  },
  {
    title: "Delayed Order Investigation",
    description:
      "Investigate a delayed order and prepare a complaint draft.",
    steps: [
      "Open Money-Leak Radar or the dashboard.",
      "Start the delayed-order investigation.",
      "Review the investigation results and retrieved evidence.",
      "Review the complaint draft.",
      "Use the available approval action only after checking the draft."
    ]
  },
  {
    title: "Evidence Intelligence",
    description:
      "Review evidence associated with a consumer claim.",
    steps: [
      "Open Evidence Intelligence when available.",
      "Select the relevant claim or investigation.",
      "Review the retrieved evidence.",
      "Verify the information before using it in a complaint."
    ]
  },
  {
    title: "Warranty Vault",
    description:
      "Keep product warranty and purchase information organized.",
    steps: [
      "Open Warranty Vault.",
      "Choose the add warranty option.",
      "Enter the available product and purchase details.",
      "Save and review the warranty record."
    ]
  },
  {
    title: "Settings and Profile",
    description:
      "Manage your profile and application preferences.",
    steps: [
      "Open your profile to manage available personal details.",
      "Open Settings to review notification preferences.",
      "Save your changes.",
      "Return to the page to confirm that the changes were retained."
    ]
  }
];

export default function HelpSupport() {
  const [search, setSearch] = useState("");
  const [openFaq, setOpenFaq] = useState(-1);
  const [openGuide, setOpenGuide] = useState(-1);

  const [category, setCategory] = useState("Technical issue");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadTickets();
  }, []);

  async function loadTickets() {
    try {
      setLoadingTickets(true);

      const response = await fetch(`${API}/support/tickets`, {
        credentials: "include"
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load support requests."
        );
      }

      setTickets(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      console.error("Support ticket loading error:", err);
      setError(err.message || "Could not load support requests.");
    } finally {
      setLoadingTickets(false);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!subject.trim() || !description.trim()) {
      setError("Please enter a subject and describe your issue.");
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`${API}/support/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          description: description.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not submit your request."
        );
      }

      setMessage(
        `Support request #${data.ticket_id} submitted successfully.`
      );

      setSubject("");
      setDescription("");

      await loadTickets();
    } catch (err) {
      console.error("Support request error:", err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredFaqs = faqs.filter((faq) => {
    const value =
      `${faq.question} ${faq.answer} ${faq.category}`;

    return value.toLowerCase().includes(search.toLowerCase());
  });

  const filteredGuides = guides.filter((guide) => {
    const value =
      `${guide.title} ${guide.description} ${guide.steps.join(" ")}`;

    return value.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="help-page">

      <header className="help-header">
        <div className="help-header-icon">
          <LifeBuoy size={27} />
        </div>

        <div>
          <span className="help-eyebrow">
            CLAIMPILOT ASSISTANCE
          </span>
          <h1>Help & Support</h1>
          <p>
            Find answers, explore feature guides and get help
            with your consumer protection workspace.
          </p>
        </div>
      </header>

      <section className="help-hero">
        <div>
          <span className="help-hero-label">NEED A HAND?</span>
          <h2>Find the help you need.</h2>
          <p>
            Search our help resources or submit a support
            request if you need assistance.
          </p>
        </div>

        <div className="help-hero-icon">
          <MessageCircle size={65} />
        </div>
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <Search size={21} />
          </div>

          <div>
            <h2>Search Help Center</h2>
            <p>Search FAQs and feature guides in one place.</p>
          </div>
        </div>

        <div className="help-search">
          <Search size={19} />
          <input
            type="text"
            placeholder="Search questions, features or guides..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpenFaq(-1);
              setOpenGuide(-1);
            }}
          />
        </div>
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <FileText size={21} />
          </div>

          <div>
            <h2>Frequently Asked Questions</h2>
            <p>Answers to common ClaimPilot questions.</p>
          </div>
        </div>

        <div className="help-faq-list">
          {filteredFaqs.map((faq, index) => {
            const isOpen = openFaq === index;

            return (
              <div className="help-faq-item" key={faq.question}>
                <button
                  type="button"
                  className="help-faq-question"
                  onClick={() =>
                    setOpenFaq(isOpen ? -1 : index)
                  }
                >
                  <span>
                    <small>{faq.category}</small>
                    <strong>{faq.question}</strong>
                  </span>

                  {isOpen ? (
                    <ChevronUp size={19} />
                  ) : (
                    <ChevronDown size={19} />
                  )}
                </button>

                {isOpen && (
                  <div className="help-faq-answer">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}

          {filteredFaqs.length === 0 && (
            <p className="help-empty">
              No matching FAQs found.
            </p>
          )}
        </div>
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <BookOpen size={21} />
          </div>

          <div>
            <h2>Getting Started and Feature Guides</h2>
            <p>Step-by-step instructions for using ClaimPilot.</p>
          </div>
        </div>

        <div className="help-faq-list">
          {filteredGuides.map((guide, index) => {
            const isOpen = openGuide === index;

            return (
              <div className="help-faq-item" key={guide.title}>
                <button
                  type="button"
                  className="help-faq-question"
                  onClick={() =>
                    setOpenGuide(isOpen ? -1 : index)
                  }
                >
                  <span>
                    <small>FEATURE GUIDE</small>
                    <strong>{guide.title}</strong>
                    <small>{guide.description}</small>
                  </span>

                  {isOpen ? (
                    <ChevronUp size={19} />
                  ) : (
                    <ChevronDown size={19} />
                  )}
                </button>

                {isOpen && (
                  <div className="help-faq-answer">
                    <ol>
                      {guide.steps.map((step, stepIndex) => (
                        <li key={stepIndex}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            );
          })}

          {filteredGuides.length === 0 && (
            <p className="help-empty">
              No matching guides found.
            </p>
          )}
        </div>
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <Send size={21} />
          </div>

          <div>
            <h2>Submit a Support Request</h2>
            <p>
              Report a problem, ask a question or report a bug.
            </p>
          </div>
        </div>

        <form className="help-form" onSubmit={submitRequest}>
          <label>
            Issue category

            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            Subject

            <input
              type="text"
              placeholder="Briefly describe your issue"
              maxLength={150}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
          </label>

          <label>
            Describe your issue

            <textarea
              placeholder="Explain what happened and what help you need..."
              rows={5}
              maxLength={3000}
              value={description}
              onChange={(event) =>
                setDescription(event.target.value)
              }
              required
            />

            <small className="help-character-count">
              {description.length}/3000 characters
            </small>
          </label>

          {message && (
            <div className="help-alert success">
              <CheckCircle2 size={18} />
              {message}
            </div>
          )}

          {error && (
            <div className="help-alert error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="help-submit-button"
            disabled={submitting}
          >
            {submitting ? (
              <LoaderCircle
                size={18}
                className="help-spinner"
              />
            ) : (
              <Send size={17} />
            )}

            {submitting ? "Submitting..." : "Submit request"}
          </button>
        </form>
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <Ticket size={21} />
          </div>

          <div>
            <h2>My Support Requests</h2>
            <p>Track requests submitted from your account.</p>
          </div>
        </div>

        {loadingTickets ? (
          <div className="help-loading">
            <LoaderCircle
              size={22}
              className="help-spinner"
            />
            Loading support requests...
          </div>
        ) : tickets.length > 0 ? (
          <div className="help-ticket-list">
            {tickets.map((ticket) => (
              <div className="help-ticket" key={ticket.id}>
                <div className="help-ticket-icon">
                  <Ticket size={19} />
                </div>

                <div className="help-ticket-details">
                  <strong>{ticket.subject}</strong>

                  <p>
                    #{ticket.id} · {ticket.category}
                  </p>

                  <small>
                    <Clock size={13} />
                    {ticket.created_at ? formatDateTime(ticket.created_at) : "Date unavailable"}
                  </small>
                </div>

                <span className="help-ticket-status">
                  {ticket.status || "Open"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="help-empty">
            <Ticket size={30} />
            <strong>No support requests yet</strong>
            <p>Your submitted requests will appear here.</p>
          </div>
        )}
      </section>

      <section className="help-card">
        <div className="help-section-heading">
          <div className="help-section-icon">
            <ShieldCheck size={21} />
          </div>

          <div>
            <h2>Legal and Product Information</h2>
            <p>Important information about this demo.</p>
          </div>
        </div>

        <div id="help-terms" className="help-faq-item">
          <h3>Terms of Use</h3>
          <p className="help-faq-answer">
            ClaimPilot is a demonstration consumer-protection
            application. Information and generated drafts are
            provided to assist users with organizing claims.
            Users must independently verify information before
            taking action. ClaimPilot does not guarantee refunds
            or legal outcomes.
          </p>
        </div>

        <div id="help-privacy" className="help-faq-item">
          <h3>Privacy Information</h3>
          <p className="help-faq-answer">
            Account information and support requests are handled
            by the application's configured backend and database.
            Do not submit passwords, payment card details or other
            sensitive information through the support form.
            Review the application's data handling and deployment
            configuration before using real personal information.
          </p>
        </div>

        <p className="help-demo-note">
          These are demo disclosures, not a substitute for
          reviewed legal Terms of Service or a formal Privacy Policy.
        </p>
      </section>

      <p className="help-demo-note">
        <HelpCircle size={15} />
        ClaimPilot demo: support requests are stored in the
        application database. They are not automatically sent
        to a live support team.
      </p>

    </div>
  );
}

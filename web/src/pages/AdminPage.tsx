import { FormEvent, useEffect, useState } from "react";

const TOKEN_KEY = "admin_token";

const fileLabels: Record<string, string> = {
  "shared/company.md": "Company",
  "shared/products.md": "Products",
  "shared/pricing.md": "Pricing",
  "shared/faq.md": "FAQ",
  "shared/policies.md": "Policies",
  "shared/brand_voice.md": "Brand voice",
  "shared/sops.md": "SOPs",
};

type Tab = "profile" | "markdown";

interface WorkspaceProfile {
  company: {
    name: string;
    mission: string;
    vision: string;
    businessDescription: string;
    operatingHours: { weekdays: string; saturday: string; sunday: string };
    locations: Array<{ name: string; address: string }>;
    serviceArea: string;
    contact: {
      email: string;
      phone: string;
      website: string;
      urgentPhone: string;
    };
  };
  faqs: {
    general: Array<{ q: string; a: string }>;
    shipping: string;
    returns: string;
    delivery: string;
    payments: string;
    support: string;
  };
  [key: string]: unknown;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<WorkspaceProfile | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState("shared/company.md");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function verifyToken(currentToken: string) {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/profile", {
        headers: authHeaders(currentToken),
      });
      if (!response.ok) {
        throw new Error("Invalid admin token");
      }
      const data = await response.json();
      setProfile(data.profile);
      setAuthenticated(true);
      sessionStorage.setItem(TOKEN_KEY, currentToken);

      const knowledgeResponse = await fetch("/api/admin/knowledge", {
        headers: authHeaders(currentToken),
      });
      if (knowledgeResponse.ok) {
        const knowledge = await knowledgeResponse.json();
        setFiles(knowledge.files);
      }
    } catch {
      setAuthenticated(false);
      setStatus("Invalid admin token.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      void verifyToken(token);
    }
  }, []);

  function handleLogin(event: FormEvent) {
    event.preventDefault();
    void verifyToken(token);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile || !token) return;

    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/profile", {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to save profile");
      const data = await response.json();
      setProfile(data.profile);
      setStatus("Profile saved and shared knowledge regenerated.");

      const knowledgeResponse = await fetch("/api/admin/knowledge", {
        headers: authHeaders(token),
      });
      if (knowledgeResponse.ok) {
        const knowledge = await knowledgeResponse.json();
        setFiles(knowledge.files);
      }
    } catch {
      setStatus("Could not save profile.");
    } finally {
      setLoading(false);
    }
  }

  async function saveMarkdown() {
    if (!token) return;
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/knowledge", {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ path: activeFile, content: files[activeFile] ?? "" }),
      });
      if (!response.ok) throw new Error("Failed to save markdown");
      setStatus(`Saved ${fileLabels[activeFile] ?? activeFile}.`);
    } catch {
      setStatus("Could not save markdown file.");
    } finally {
      setLoading(false);
    }
  }

  async function resetFromBundle() {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: authHeaders(token),
      });
      if (!response.ok) throw new Error("Reset failed");
      const data = await response.json();
      setFiles(data.files);
      setStatus("Reset knowledge from bundled defaults.");
    } catch {
      setStatus("Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="admin-page">
        <div className="admin-card">
          <h1>Admin</h1>
          <p>Edit your business profile and shared knowledge without touching files directly.</p>
          <form onSubmit={handleLogin} className="admin-login">
            <label>
              Admin token
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Enter admin token"
              />
            </label>
            <button type="submit" disabled={loading || !token.trim()}>
              {loading ? "Checking…" : "Enter"}
            </button>
          </form>
          {status && <p className="admin-status">{status}</p>}
          <a href="/" className="admin-link">
            ← Back to site
          </a>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <div className="admin-page">Loading…</div>;
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <h1>Company Brain Admin</h1>
          <p>Update business facts once — all agents use the same knowledge.</p>
        </div>
        <div className="admin-header-actions">
          <a href="/" className="admin-link">
            View site
          </a>
          <button type="button" onClick={() => void resetFromBundle()} disabled={loading}>
            Reset defaults
          </button>
        </div>
      </header>

      <div className="admin-tabs">
        <button
          type="button"
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          Business profile
        </button>
        <button
          type="button"
          className={tab === "markdown" ? "active" : ""}
          onClick={() => setTab("markdown")}
        >
          Advanced markdown
        </button>
      </div>

      {status && <p className="admin-status banner">{status}</p>}

      {tab === "profile" ? (
        <form className="admin-form" onSubmit={saveProfile}>
          <section>
            <h2>Company</h2>
            <div className="field-grid">
              <label>
                Name
                <input
                  value={profile.company.name}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: { ...profile.company, name: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Mission
                <input
                  value={profile.company.mission}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: { ...profile.company, mission: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Vision
                <input
                  value={profile.company.vision}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: { ...profile.company, vision: event.target.value },
                    })
                  }
                />
              </label>
              <label className="full">
                Business description
                <textarea
                  rows={3}
                  value={profile.company.businessDescription}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: { ...profile.company, businessDescription: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Email
                <input
                  value={profile.company.contact.email}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: {
                        ...profile.company,
                        contact: { ...profile.company.contact, email: event.target.value },
                      },
                    })
                  }
                />
              </label>
              <label>
                Phone
                <input
                  value={profile.company.contact.phone}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: {
                        ...profile.company,
                        contact: { ...profile.company.contact, phone: event.target.value },
                      },
                    })
                  }
                />
              </label>
              <label className="full">
                Location
                <input
                  value={profile.company.locations[0]?.address ?? ""}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      company: {
                        ...profile.company,
                        locations: [
                          {
                            name: profile.company.locations[0]?.name ?? "Main hub",
                            address: event.target.value,
                          },
                        ],
                      },
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section>
            <h2>FAQs</h2>
            {profile.faqs.general.map((faq, index) => (
              <div key={index} className="faq-row">
                <input
                  value={faq.q}
                  placeholder="Question"
                  onChange={(event) => {
                    const general = [...profile.faqs.general];
                    general[index] = { ...faq, q: event.target.value };
                    setProfile({ ...profile, faqs: { ...profile.faqs, general } });
                  }}
                />
                <input
                  value={faq.a}
                  placeholder="Answer"
                  onChange={(event) => {
                    const general = [...profile.faqs.general];
                    general[index] = { ...faq, a: event.target.value };
                    setProfile({ ...profile, faqs: { ...profile.faqs, general } });
                  }}
                />
              </div>
            ))}
          </section>

          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Saving…" : "Save profile & regenerate knowledge"}
          </button>
        </form>
      ) : (
        <div className="markdown-editor">
          <aside>
            {Object.keys(fileLabels).map((file) => (
              <button
                key={file}
                type="button"
                className={activeFile === file ? "active" : ""}
                onClick={() => setActiveFile(file)}
              >
                {fileLabels[file]}
              </button>
            ))}
          </aside>
          <div>
            <textarea
              rows={24}
              value={files[activeFile] ?? ""}
              onChange={(event) =>
                setFiles({ ...files, [activeFile]: event.target.value })
              }
            />
            <button type="button" className="primary" onClick={() => void saveMarkdown()} disabled={loading}>
              Save {fileLabels[activeFile]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

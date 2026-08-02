import { Link } from "react-router-dom";
import { ChatWidget } from "../components/ChatWidget";

const AGENTS = [
  {
    id: "reception",
    name: "Reception",
    summary:
      "Greets customers, answers FAQs from your knowledge base, and books appointments from real availability. Escalates to a human with full context when it should.",
    handles: ["FAQs", "Bookings", "Escalation"],
    featured: true,
  },
  {
    id: "sales",
    name: "Sales",
    summary:
      "Quotes only from your approved catalog and captures budget, timeline, and intent on every lead.",
    handles: ["Quotes", "Lead capture"],
    featured: false,
  },
  {
    id: "marketing",
    name: "Marketing",
    summary:
      "Drafts campaigns and lead magnets in your brand voice. Never replies to inbound customer messages.",
    handles: ["Campaigns", "Brand voice"],
    featured: false,
  },
] as const;

const OS_POINTS = [
  {
    title: "Shared memory",
    body: "Customer profiles and history persist across WhatsApp, Instagram, web chat, and email.",
  },
  {
    title: "Smart routing",
    body: "Every message reaches the right agent, with clean handoffs between them mid-conversation.",
  },
  {
    title: "Approved knowledge only",
    body: "Agents answer from your documents, catalog, and policies. No invented prices, no guesses.",
  },
  {
    title: "Human escalation",
    body: "Frustration is detected early and handed to your team with the full conversation attached.",
  },
] as const;

export function HomePage() {
  return (
    <div className="home">
      <nav className="home-nav" aria-label="Main">
        <Link to="/" className="home-nav__brand">
          <span className="home-nav__mark" aria-hidden="true">
            H
          </span>
          Harbor AI
        </Link>
        <div className="home-nav__actions">
          <Link to="/login" className="home-nav__signin">
            Sign in
          </Link>
          <Link to="/register" className="btn-pill">
            Create your workspace
          </Link>
        </div>
      </nav>

      <header className="home-hero">
        <div className="home-hero__copy">
          <h1>
            AI employees that run your front office
            <span className="home-hero__dot">.</span>
          </h1>
          <p>
            Reception, sales, and marketing agents answer WhatsApp, Instagram, and
            web chat from one shared company brain.
          </p>
          <div className="home-hero__actions">
            <Link to="/register" className="btn-pill">
              Create your workspace
            </Link>
            <a href="#agents" className="btn-pill btn-pill--outline">
              See how it works
            </a>
          </div>
        </div>
        <div className="home-hero__panel" aria-hidden="true">
          <div className="home-hero__chips">
            <span className="home-hero__chip">
              <strong>Reception</strong> booked a consultation
            </span>
            <span className="home-hero__chip">
              <strong>Sales</strong> quoted from the catalog
            </span>
            <span className="home-hero__chip">
              <strong>Marketing</strong> drafted a campaign
            </span>
          </div>
        </div>
      </header>

      <section className="home-agents" id="agents" aria-label="The agents">
        <h2>One front office, three specialists</h2>
        <div className="home-agents__grid">
          {AGENTS.map((agent) => (
            <article
              key={agent.id}
              className={`home-agent${agent.featured ? " home-agent--featured" : ""}`}
            >
              <h3>{agent.name}</h3>
              <p>{agent.summary}</p>
              <div className="home-agent__handles">
                {agent.handles.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-os" aria-label="The OS layer">
        <div className="home-os__intro">
          <h2>Everything shares one company brain</h2>
          <p>
            Upload your documents, catalog, and policies once. Every agent reads
            from the same source of truth.
          </p>
        </div>
        <div className="home-os__grid">
          {OS_POINTS.map((point) => (
            <div key={point.title} className="home-os__point">
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </div>
          ))}
        </div>
        <Link to="/register" className="btn-pill home-os__cta">
          Create your workspace
        </Link>
      </section>

      <footer className="home-footer">
        <span>Harbor AI</span>
        <span>Try the live chat in the corner to see routing in action.</span>
        <Link to="/login">Sign in</Link>
      </footer>

      <ChatWidget pageUrl="https://harbor-ai-business-os.netlify.app/" />
    </div>
  );
}

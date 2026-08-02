import { useParams } from "react-router-dom";
import { ChatWidget } from "../components/ChatWidget";

export function EmbedPage() {
  const { publicKey } = useParams();

  if (!publicKey) {
    return (
      <div className="embed-page">
        <p>Missing workspace key.</p>
      </div>
    );
  }

  return (
    <div className="embed-page">
      <ChatWidget
        pageUrl={typeof window !== "undefined" ? window.location.href : "/embed"}
        publicKey={publicKey}
        workspaceName="Chat"
        greeting="Hi — how can we help today?"
      />
    </div>
  );
}

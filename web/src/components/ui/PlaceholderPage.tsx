import { PageHeader } from "./PageHeader";
import { Card } from "./Card";

interface PlaceholderPageProps {
  title: string;
  description: string;
  sections?: string[];
}

export function PlaceholderPage({
  title,
  description,
  sections = ["Coming soon"],
}: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <PageHeader title={title} description={description} />
      <div className="placeholder-grid">
        {sections.map((section) => (
          <Card key={section} title={section}>
            <p className="placeholder-copy">
              This section is a placeholder. Content and business logic will be added later.
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

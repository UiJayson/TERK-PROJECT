interface NavIconProps {
  name: string;
}

export function NavIcon({ name }: NavIconProps) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case "agents":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3 19c1.5-3 4-4.5 6-4.5S13.5 16 15 19" />
          <path d="M14 19c.8-1.8 2.2-2.8 3.5-2.8S20.8 17.4 21.5 19" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M4 5h16v11H8l-4 3V5z" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 5h7v14H4z" />
          <path d="M13 5h7v14h-7z" />
          <path d="M11 5v14" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c1.2-3 3.5-4.5 6-4.5S16.8 16 18 19" />
          <circle cx="17" cy="9" r="2.5" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 15v-4" />
          <path d="M12 15V8" />
          <path d="M16 15v-7" />
        </svg>
      );
    case "plug":
      return (
        <svg {...common}>
          <path d="M9 7v4" />
          <path d="M15 7v4" />
          <path d="M8 11h8v3a4 4 0 0 1-8 0v-3z" />
          <path d="M12 18v3" />
        </svg>
      );
    case "channels":
      return (
        <svg {...common}>
          <path d="M7 8h10" />
          <path d="M5 12h14" />
          <path d="M8 16h8" />
          <circle cx="5" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="7" cy="16" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
        </svg>
      );
    case "gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.5M12 18.5V21M4.9 6.5l1.8 1.8M17.3 15.7l1.8 1.8M3 12h2.5M18.5 12H21M4.9 17.5l1.8-1.8M17.3 8.3l1.8-1.8" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 16V10a6 6 0 1 1 12 0v6" />
          <path d="M5 16h14" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      );
    case "collapse":
      return (
        <svg {...common}>
          <path d="m14 7-5 5 5 5" />
        </svg>
      );
    case "expand":
      return (
        <svg {...common}>
          <path d="m10 7 5 5-5 5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

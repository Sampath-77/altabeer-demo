import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#f8fafc",
      color: "#1f2937",
      fontFamily: "system-ui, sans-serif",
      padding: 20,
    }}>
      <div style={{
        maxWidth: 420,
        width: "100%",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 20,
        padding: 32,
        textAlign: "center",
        boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
      }}>
        <div style={{
          fontSize: 48,
          fontWeight: 800,
          color: "#f97316",
          marginBottom: 8,
        }}>
          404
        </div>
        <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>Page Not Found</h2>
        <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 24px" }}>
          The page you requested does not exist or has been moved.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          <Link
            href="/"
            style={{
              display: "block",
              background: "#f97316",
              color: "#fff",
              padding: "12px 18px",
              borderRadius: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Driver Home / Dashboard
          </Link>

          <Link
            href="/admin"
            style={{
              display: "block",
              background: "#1a2748",
              color: "#fff",
              padding: "12px 18px",
              borderRadius: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Admin Dashboard
          </Link>

          <Link
            href="/login"
            style={{
              display: "block",
              border: "1px solid #e5e7eb",
              color: "#4b5563",
              padding: "10px 18px",
              borderRadius: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sign In Screen
          </Link>
        </div>
      </div>
    </div>
  );
}


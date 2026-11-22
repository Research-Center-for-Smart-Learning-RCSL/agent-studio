import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "0 24px",
          height: 56,
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <Link href="/" style={{ fontWeight: 600, fontSize: 17, color: "#111", textDecoration: "none" }}>
          Agent Studio
        </Link>
        <nav style={{ display: "flex", gap: 16, flex: 1 }}>
          <Link href="/">Agents</Link>
          {user.isAdmin && <Link href="/admin">管理</Link>}
        </nav>
        <span style={{ color: "#555", fontSize: 14 }}>{user.email}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" style={{ border: "none", background: "none", color: "#1677ff", cursor: "pointer" }}>
            登出
          </button>
        </form>
      </header>
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>{children}</main>
    </div>
  );
}

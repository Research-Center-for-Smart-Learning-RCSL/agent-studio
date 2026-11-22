import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <header className="studio-header">
        <div className="studio-header-inner">
          <Link href="/" className="studio-brand">
            <span className="studio-mark" aria-hidden="true" />
            Agent Studio
          </Link>
          <nav className="studio-nav" aria-label="主導覽">
            <Link href="/">Agents</Link>
            {user.isAdmin && <Link href="/admin">管理</Link>}
          </nav>
          <div className="studio-account">
            <span className="studio-email" title={user.email}>{user.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="studio-button" type="submit">登出</button>
            </form>
          </div>
        </div>
      </header>
      <main className="studio-main">{children}</main>
    </>
  );
}

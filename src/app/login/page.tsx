import { redirect } from "next/navigation";
import { auth, devLoginEnabled, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
        style={{ background: "#fff", padding: 40, borderRadius: 12, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Agent Studio</h1>
        <p style={{ margin: "0 0 24px", color: "#666" }}>RCSL agent 編輯與版本管理</p>
        <button
          type="submit"
          style={{ padding: "10px 24px", fontSize: 15, borderRadius: 6, border: "1px solid #d0d7de", background: "#fff", cursor: "pointer" }}
        >
          使用 Google 帳號登入
        </button>
        {devLoginEnabled && (
          <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
            <input name="email" placeholder="dev email" style={{ padding: 6, marginRight: 8 }} />
            <button
              formAction={async (data: FormData) => {
                "use server";
                await signIn("dev", { email: data.get("email"), redirectTo: "/" });
              }}
            >
              開發登入
            </button>
          </div>
        )}
      </form>
    </main>
  );
}

import { redirect } from "next/navigation";
import { auth, devLoginEnabled, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="studio-login">
      <section className="studio-panel login-card" aria-labelledby="login-title">
        <span className="studio-mark" aria-hidden="true" />
        <h1 id="login-title">Agent Studio</h1>
        <p>RCSL agent 編輯與版本管理</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="studio-button login-primary" type="submit">使用 Google 帳號登入</button>
        </form>
        {devLoginEnabled && (
          <form
            className="login-dev"
            action={async (data: FormData) => {
              "use server";
              await signIn("dev", { email: data.get("email"), redirectTo: "/" });
            }}
          >
            <label htmlFor="dev-email">開發帳號</label>
            <input id="dev-email" name="email" placeholder="dev@example.com" required />
            <button className="studio-button" type="submit">開發登入</button>
          </form>
        )}
      </section>
    </main>
  );
}

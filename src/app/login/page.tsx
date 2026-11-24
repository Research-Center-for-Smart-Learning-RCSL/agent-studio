import { LanguageSelect } from "@/lib/i18n-client";
import { getTranslator } from "@/lib/i18n-server";
import { redirect } from "next/navigation";
import { auth, devLoginEnabled, signIn } from "@/auth";

export default async function LoginPage() {
  const t = await getTranslator();
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="studio-login">
      <section className="studio-panel login-card" aria-labelledby="login-title">
        <LanguageSelect />
        <span className="studio-mark" aria-hidden="true" />
        <h1 id="login-title">RCSL Agent Studio</h1>
        <p>{t("RCSL agent 編輯與版本管理")}</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="studio-button login-primary" type="submit">{t("使用 Google 帳號登入")}</button>
        </form>
        {devLoginEnabled && (
          <form
            className="login-dev"
            action={async (data: FormData) => {
              "use server";
              await signIn("dev", { email: data.get("email"), redirectTo: "/" });
            }}
          >
            <label htmlFor="dev-email">{t("開發帳號")}</label>
            <input id="dev-email" name="email" placeholder="dev@example.com" required />
            <button className="studio-button" type="submit">{t("開發登入")}</button>
          </form>
        )}
      </section>
    </main>
  );
}
